import streamlit as st
import requests
import json

BASE_URL = "http://127.0.0.1:8000"

st.set_page_config(page_title="Digital Signing Gateway", layout="centered")

st.title("📄 Digital Signing Tool")

tab1, tab2, tab3, tab4 = st.tabs(["Service Status", "Single Sign", "Multi-Sign Upload", "Multi-Sign Sign"])

# TAB 1: Service Status
with tab1:
    st.header("Service Status")
    try:
        res = requests.get(f"{BASE_URL}/")
        if res.status_code == 200:
            st.success(res.json()["message"])
        else:
            st.error("Service not reachable.")
    except Exception as e:
        st.error(f"Error: {e}")

# TAB 2: Single PDF Sign
with tab2:
    st.header("Sign a File")
    with st.form("sign_form"):
        myfile = st.file_uploader("Upload PDF", type="pdf")
        dept = st.text_input("Department")
        doctype = st.text_input("Document Type")
        reqid = st.text_input("Request ID")
        submit = st.form_submit_button("Sign File")

    if submit and myfile:
        files = {"myfile": myfile.getvalue()}
        data = {
            "department": dept,
            "document_type": doctype,
            "request_id": reqid
        }
        res = requests.post(f"{BASE_URL}/sign/file", files={"myfile": myfile}, data=data)
        if res.status_code == 200:
            st.success("File signed successfully!")
            dl_url = res.json()["download_url"]
            filename = dl_url.split("/")[-1]
            st.download_button("⬇ Download Signed File", data=requests.get(f"{BASE_URL}{dl_url}").content, file_name=filename)
        else:
            st.error(res.json()["detail"])

# TAB 3: Multi-Sign Upload
with tab3:
    st.header("Multi-Signer Upload")
    with st.form("multi_upload_form"):
        file = st.file_uploader("Upload PDF", type="pdf")
        uuid = st.text_input("UUID")
        cs = st.text_input("Checksum (cs)")
        workid = st.text_input("Initiator Work ID")
        dept = st.text_input("Initiator Department")
        workflow = st.text_input("Workflow ID")
        signerlist = st.text_area("Signer List (JSON)")
        upload = st.form_submit_button("Create Multi-Sign Session")

    if upload and file:
        try:
            json.loads(signerlist)  # Validate
            data = {
                "uuid": uuid,
                "cs": cs,
                "initiator_workid": workid,
                "initiator_work_dept": dept,
                "workflow_id": workflow,
                "signerlist": signerlist
            }
            res = requests.post(f"{BASE_URL}/multi-sign/upload", files={"myfile": file}, data=data)
            if res.status_code == 200:
                response = res.json()
                st.success("Session created.")
                st.write("Next signer:", response["next_signer_email"])
                st.write("Download URL:", response["download_url"])
            else:
                st.error(res.json()["detail"])
        except json.JSONDecodeError:
            st.error("Invalid JSON in signerlist.")

# TAB 4: Multi-Sign Sign
with tab4:
    st.header("Multi-Signer: Sign a Document")
    with st.form("multi_sign_form"):
        uuid = st.text_input("UUID")
        email = st.text_input("Signer Email")
        sign = st.form_submit_button("Sign Now")

    if sign:
        email_encoded = email.replace("@", "%40")
        url = f"{BASE_URL}/multi-sign/sign/{uuid}/{email_encoded}"
        res = requests.get(url)
        if res.status_code == 200:
            try:
                response_data = res.json()
                dl_url = response_data.get("download_url")
                if dl_url:
                    filename = dl_url.split("/")[-1]
                    file_response = requests.get(f"{BASE_URL}{dl_url}")
                    content = file_response.content
                    st.success(f"Signed by {email}")
                    st.download_button(
                        label="⬇ Download Signed PDF",
                        data=content,
                        file_name=f"{filename if filename.endswith('.pdf') else filename + '.pdf'}",
                        mime="application/pdf"
                    )
                else:
                    st.error("Download URL not found in response.")
            except Exception as e:
                st.error(f"Error parsing response: {e}")
        else:
            try:
                error_detail = res.json().get("detail", "Unknown error.")
            except:
                error_detail = "Unexpected response from server."
            st.error(f"Failed to sign: {error_detail}")
