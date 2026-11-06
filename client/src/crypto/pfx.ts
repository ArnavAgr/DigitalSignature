import forge from 'node-forge';

export interface ExtractedSignerContext {
  webCryptoKey: CryptoKey;
  leafCertForge: forge.pki.Certificate;
  leafCertDer: Uint8Array;
  caChainDers: Uint8Array[];
  details: {
    commonName: string;
    organization: string;
    country: string;
    validFrom: Date;
    validTo: Date;
    keySizeBits: number;
    hasKeyUsage: boolean;
    keyUsage?: {
      digitalSignature: boolean;
      nonRepudiation: boolean;
    };
  };
}

/**
 * Parses a PKCS#12 container, resolves the matching leaf certificate,
 * converts the RSA key to a standard WebCrypto CryptoKey,
 * and performs mathematical sign/verify proof.
 */
export async function parseAndUnlockPfx(
  pfxBytes: Uint8Array,
  password: string
): Promise<ExtractedSignerContext> {
  // Convert Uint8Array to binary string for node-forge
  let pfxBinary = '';
  for (let i = 0; i < pfxBytes.length; i++) {
    pfxBinary += String.fromCharCode(pfxBytes[i]);
  }

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const p12Asn1 = forge.asn1.fromDer(pfxBinary);
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('mac') || message.toLowerCase().includes('password') || message.toLowerCase().includes('pkcs')) {
      throw new Error('Invalid PFX password or damaged certificate container.');
    }
    throw new Error(`Unable to parse PKCS#12 container: ${message}`);
  }

  // Extract all keys and certificates from safe bags
  const extractedKeys: Array<{ key: forge.pki.rsa.PrivateKey; localKeyId?: string }> = [];
  const extractedCerts: Array<{ cert: forge.pki.Certificate; localKeyId?: string }> = [];

  for (const safeContents of p12.safeContents) {
    for (const safeBag of safeContents.safeBags) {
      const localKeyId = safeBag.attributes?.localKeyId?.[0];

      if (safeBag.key) {
        extractedKeys.push({
          key: safeBag.key as forge.pki.rsa.PrivateKey,
          localKeyId
        });
      }

      if (safeBag.cert) {
        extractedCerts.push({
          cert: safeBag.cert,
          localKeyId
        });
      }
    }
  }

  if (extractedKeys.length === 0) {
    throw new Error('No private key found in the PKCS#12 container.');
  }

  if (extractedCerts.length === 0) {
    throw new Error('No certificate found in the PKCS#12 container.');
  }

  // Select primary private key (MVP supports 1 signer key)
  const primaryKeyEntry = extractedKeys[0];
  const primaryKey = primaryKeyEntry.key;

  // Multi-certificate disambiguation
  let leafCert: forge.pki.Certificate | null = null;

  // 1. Match by localKeyId if present
  if (primaryKeyEntry.localKeyId) {
    const matched = extractedCerts.find(c => c.localKeyId === primaryKeyEntry.localKeyId);
    if (matched) {
      leafCert = matched.cert;
    }
  }

  // 2. Fallback: match by RSA modulus
  if (!leafCert) {
    const matched = extractedCerts.find(c => {
      const rsaPub = c.cert.publicKey as forge.pki.rsa.PublicKey;
      return rsaPub?.n && primaryKey.n && rsaPub.n.compareTo(primaryKey.n) === 0;
    });
    if (matched) {
      leafCert = matched.cert;
    }
  }

  if (!leafCert) {
    throw new Error('Could not identify a certificate matching the unlocked private key in the PFX container.');
  }

  // Convert node-forge RSA Private Key to PKCS#8 DER binary
  const rsaAsn1 = forge.pki.privateKeyToAsn1(primaryKey);
  const pkcs8Asn1 = forge.pki.wrapRsaPrivateKey(rsaAsn1);
  const pkcs8Der = forge.asn1.toDer(pkcs8Asn1).getBytes();

  const pkcs8Bytes = new Uint8Array(pkcs8Der.length);
  for (let i = 0; i < pkcs8Der.length; i++) {
    pkcs8Bytes[i] = pkcs8Der.charCodeAt(i);
  }

  // Convert Leaf Certificate public key to SPKI DER binary for mathematical proof
  const spkiAsn1 = (forge.pki as any).publicKeyToSubjectPublicKeyInfo(leafCert.publicKey);
  const spkiDer = forge.asn1.toDer(spkiAsn1).getBytes();
  const spkiBytes = new Uint8Array(spkiDer.length);
  for (let i = 0; i < spkiDer.length; i++) {
    spkiBytes[i] = spkiDer.charCodeAt(i);
  }

  // Import into WebCrypto subtle engine
  let webCryptoPrivateKey: CryptoKey;
  let webCryptoPublicKey: CryptoKey;

  try {
    webCryptoPrivateKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8Bytes.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, // private key cannot be extracted out of WebCrypto
      ['sign']
    );

    webCryptoPublicKey = await crypto.subtle.importKey(
      'spki',
      spkiBytes.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['verify']
    );
  } finally {
    // Memory hygiene: zero sensitive binary buffers immediately
    pkcs8Bytes.fill(0);
    spkiBytes.fill(0);
  }

  // Mathematical proof: Sign a 32-byte nonce with the private key and verify against the cert public key
  const challengeNonce = new Uint8Array(32);
  crypto.getRandomValues(challengeNonce);

  const proofSig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', webCryptoPrivateKey, challengeNonce);
  const pairMatches = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', webCryptoPublicKey, proofSig, challengeNonce);

  if (!pairMatches) {
    throw new Error('Cryptographic pairing failure: Private key does not mathematically match the certificate public key.');
  }

  // Certificate Date Validity Check
  const now = new Date();
  const notBefore = leafCert.validity.notBefore;
  const notAfter = leafCert.validity.notAfter;

  if (now < notBefore) {
    throw new Error(`Certificate is not yet valid (valid from ${notBefore.toISOString()}).`);
  }
  if (now > notAfter) {
    throw new Error(`Certificate expired on ${notAfter.toISOString()}. Signing aborted.`);
  }

  // KeyUsage Validation (RFC 5280)
  // Only validate if extension is present. Absent KeyUsage is permitted.
  let hasKeyUsage = false;
  let keyUsageFlags = { digitalSignature: false, nonRepudiation: false };

  const keyUsageExt = leafCert.getExtension('keyUsage') as any;
  if (keyUsageExt) {
    hasKeyUsage = true;
    keyUsageFlags.digitalSignature = !!keyUsageExt.digitalSignature;
    keyUsageFlags.nonRepudiation = !!(keyUsageExt.nonRepudiation || keyUsageExt.contentCommitment);

    if (!keyUsageFlags.digitalSignature && !keyUsageFlags.nonRepudiation) {
      throw new Error(
        'Certificate KeyUsage extension does not permit digital signatures (neither digitalSignature nor nonRepudiation is asserted).'
      );
    }
  }

  // Convert Leaf Cert to DER
  const leafCertAsn1 = forge.pki.certificateToAsn1(leafCert);
  const leafDerBytes = derStringToBytes(forge.asn1.toDer(leafCertAsn1).getBytes());

  // Collect Remaining Certificates as CA Chain
  const caChainDers: Uint8Array[] = [];
  for (const entry of extractedCerts) {
    if (entry.cert !== leafCert) {
      const caAsn1 = forge.pki.certificateToAsn1(entry.cert);
      caChainDers.push(derStringToBytes(forge.asn1.toDer(caAsn1).getBytes()));
    }
  }

  const commonName = leafCert.subject.getField('CN')?.value as string || 'Unknown Signer';
  const organization = leafCert.subject.getField('O')?.value as string || 'Unknown Org';
  const country = leafCert.subject.getField('C')?.value as string || '';
  const keySizeBits = (primaryKey as any).n?.bitLength() || 2048;

  return {
    webCryptoKey: webCryptoPrivateKey,
    leafCertForge: leafCert,
    leafCertDer: leafDerBytes,
    caChainDers,
    details: {
      commonName,
      organization,
      country,
      validFrom: notBefore,
      validTo: notAfter,
      keySizeBits,
      hasKeyUsage,
      keyUsage: hasKeyUsage ? keyUsageFlags : undefined
    }
  };
}

function derStringToBytes(derStr: string): Uint8Array {
  const bytes = new Uint8Array(derStr.length);
  for (let i = 0; i < derStr.length; i++) {
    bytes[i] = derStr.charCodeAt(i);
  }
  return bytes;
}
