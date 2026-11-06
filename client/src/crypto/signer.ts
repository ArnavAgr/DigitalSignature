import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';
import type { ExtractedSignerContext } from './pfx.ts';

export interface CmsSignatureResult {
  cmsDer: Uint8Array;
  cmsHex: string;
}

/**
 * Constructs a PAdES Baseline B-B compliant CMS/PKCS#7 SignedData structure
 * in accordance with ETSI EN 319 142-1 V1.2.1 and RFC 5652.
 * 
 * Rules enforced:
 * - ContentType: id-data (1.2.840.113549.1.7.1), detached content
 * - DigestAlgorithm: SHA-256 (2.16.840.1.101.3.4.2.1)
 * - SignedAttributes:
 *     1. id-contentType (1.2.840.113549.1.9.3) -> id-data
 *     2. id-messageDigest (1.2.840.113549.1.9.4) -> SHA-256 of PDF ByteRange
 *     3. id-aa-signingCertificateV2 (1.2.840.113549.1.9.16.2.47) -> ESSCertIDv2 (SHA-256 hash of leaf cert)
 *     * Explicitly NO id-signingTime (1.2.840.113549.1.9.5), as forbidden by Table 1 of ETSI EN 319 142-1 V1.2.1
 * - SignedAttributes DER encoded with SET OF tag 0x31 per RFC 5652
 * - Signed with WebCrypto CryptoKey (RSASSA-PKCS1-v1_5)
 */
export async function createPadesCmsSignature(
  byteRangeDigest: Uint8Array,
  signerContext: ExtractedSignerContext
): Promise<CmsSignatureResult> {
  // 1. Parse Leaf Certificate into pkijs
  const leafAsn1 = asn1js.fromBER(signerContext.leafCertDer.buffer);
  if (leafAsn1.offset === -1) {
    throw new Error('Failed to parse signer leaf certificate ASN.1 structure.');
  }
  const leafCert = new pkijs.Certificate({ schema: leafAsn1.result });

  // 2. Parse CA Chain Certificates into pkijs
  const allCerts: pkijs.Certificate[] = [leafCert];
  for (const caDer of signerContext.caChainDers) {
    const caAsn1 = asn1js.fromBER(caDer.buffer);
    if (caAsn1.offset !== -1) {
      allCerts.push(new pkijs.Certificate({ schema: caAsn1.result }));
    }
  }

  // 3. Compute SHA-256 Digest of the Leaf Certificate DER for ESSCertIDv2
  const certHashBuf = await crypto.subtle.digest('SHA-256', signerContext.leafCertDer.buffer as ArrayBuffer);
  const certHash = new Uint8Array(certHashBuf);

  // 4. Construct ESSCertIDv2 (RFC 5035)
  // ESSCertIDv2 ::= SEQUENCE {
  //    hashAlgorithm  AlgorithmIdentifier DEFAULT {algorithm id-sha256},
  //    certHash       Hash (OCTET STRING)
  // }
  const essCertIdV2 = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [new asn1js.ObjectIdentifier({ value: '2.16.840.1.101.3.4.2.1' })] // id-sha256
      }),
      new asn1js.OctetString({ valueHex: certHash.buffer })
    ]
  });

  // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
  const signingCertV2 = new asn1js.Sequence({
    value: [new asn1js.Sequence({ value: [essCertIdV2] })]
  });

  // 5. Construct SignedAttributes
  // Mandatory for PAdES B-B: contentType, messageDigest, signingCertificateV2
  // Must NOT contain: signingTime
  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new pkijs.Attribute({
        type: '1.2.840.113549.1.9.3', // id-contentType
        values: [new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.7.1' })]
      }),
      new pkijs.Attribute({
        type: '1.2.840.113549.1.9.4', // id-messageDigest
        values: [new asn1js.OctetString({ valueHex: byteRangeDigest.buffer })]
      }),
      new pkijs.Attribute({
        type: '1.2.840.113549.1.9.16.2.47', // id-aa-signingCertificateV2
        values: [signingCertV2]
      })
    ]
  });

  // 6. Build SignedData structure
  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: '1.2.840.113549.1.7.1' // id-data (detached)
    }),
    certificates: allCerts,
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: leafCert.issuer,
          serialNumber: leafCert.serialNumber
        }),
        signedAttrs
      })
    ]
  });

  // 7. Sign using WebCrypto CryptoKey
  // pkijs internally handles RFC 5652 SET OF (0x31) encoding of signedAttrs
  await signedData.sign(signerContext.webCryptoKey, 0, 'SHA-256');

  // 8. Wrap into CMS ContentInfo (id-signedData: 1.2.840.113549.1.7.2)
  const contentInfo = new pkijs.ContentInfo({
    contentType: '1.2.840.113549.1.7.2',
    content: signedData.toSchema(true)
  });

  const cmsDer = new Uint8Array(contentInfo.toSchema().toBER(false));

  // Convert DER to hexadecimal string for PDF /Contents
  let cmsHex = '';
  for (let i = 0; i < cmsDer.length; i++) {
    const hex = cmsDer[i].toString(16).padStart(2, '0');
    cmsHex += hex;
  }
  cmsHex = cmsHex.toUpperCase();

  return {
    cmsDer,
    cmsHex
  };
}
