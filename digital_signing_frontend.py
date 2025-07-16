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
# with tab3:
#     st.header("Multi-Signer Upload")
#     with st.form("multi_upload_form"):
#         file = st.file_uploader("Upload PDF", type="pdf")
#         uuid = st.text_input("UUID")
#         cs = st.text_input("Checksum (cs)")
#         workid = st.text_input("Initiator Work ID")
#         dept = st.text_input("Initiator Department")
#         workflow = st.text_input("Workflow ID")
#         signerlist = st.text_area("Signer List (JSON)")
#         upload = st.form_submit_button("Create Multi-Sign Session")

#     if upload and file:
#         try:
#             json.loads(signerlist)  # Validate
#             data = {
#                 "uuid": uuid,
#                 "cs": cs,
#                 "initiator_workid": workid,
#                 "initiator_work_dept": dept,
#                 "workflow_id": workflow,
#                 "signerlist": signerlist
#             }
#             res = requests.post(f"{BASE_URL}/multi-sign/upload", files={"myfile": file}, data=data)
#             if res.status_code == 200:
#                 response = res.json()
#                 st.success("Session created.")
#                 st.write("Next signer:", response["next_signer_email"])
#                 st.write("Download URL:", response["download_url"])
#             else:
#                 st.error(res.json()["detail"])
#         except json.JSONDecodeError:
#             st.error("Invalid JSON in signerlist.")

# with tab3:
#     import json

#     if "signers" not in st.session_state:
#         st.session_state.signers = [{}]  # Start with one signer by default

#     with st.form("multi_sign_upload"):
#         st.header("Multi-Signer: Upload Document")

#         file = st.file_uploader("Upload PDF", type=["pdf"])
#         uuid = st.text_input("UUID")
#         cs = st.text_input("Checksum (cs)")
#         initiator_workid = st.text_input("Initiator Work ID")
#         initiator_dept = st.text_input("Initiator Department")
#         workflow_id = st.text_input("Workflow ID")

#         st.subheader("Signer List")

#         new_signers = []
#         for i, signer in enumerate(st.session_state.signers):
#             st.markdown(f"**Signer {i+1}**")
#             signer_workid = st.text_input(f"Signer {i+1} Work ID", key=f"workid_{i}")
#             signer_name = st.text_input(f"Signer {i+1} Name", key=f"name_{i}")
#             signer_email = st.text_input(f"Signer {i+1} Email", key=f"email_{i}")

#             locations = []
#             loc_count = st.number_input(f"How many signature locations for Signer {i+1}?", min_value=1, max_value=5, step=1, key=f"loc_count_{i}")
#             for j in range(loc_count):
#                 col1, col2, col3 = st.columns(3)
#                 with col1:
#                     page = st.number_input(f"Page #{j+1}", min_value=1, key=f"page_{i}_{j}")
#                 with col2:
#                     x = st.number_input(f"X Pos #{j+1}", key=f"x_{i}_{j}")
#                 with col3:
#                     y = st.number_input(f"Y Pos #{j+1}", key=f"y_{i}_{j}")
#                 locations.append({"page": int(page), "x": float(x), "y": float(y)})

#             new_signers.append({
#                 "signer_workid": signer_workid,
#                 "signer_name": signer_name,
#                 "signer_email": signer_email,
#                 "locations": locations
#             })

#         if st.button("➕ Add Another Signer"):
#             st.session_state.signers.append({})

#         submitted = st.form_submit_button("Upload and Create Multi-Sign Session")

#         if submitted:
#             if not file:
#                 st.error("Please upload a PDF file.")
#             else:
#                 files = {"myfile": (file.name, file.getvalue(), "application/pdf")}
#                 data = {
#                     "uuid": uuid,
#                     "cs": cs,
#                     "initiator_workid": initiator_workid,
#                     "initiator_work_dept": initiator_dept,
#                     "workflow_id": workflow_id,
#                     "signerlist": json.dumps(new_signers)
#                 }
#                 response = requests.post(f"{BASE_URL}/multi-sign/upload", files=files, data=data)
#                 if response.status_code == 200:
#                     st.success("Upload successful!")
#                     st.write(response.json())
#                 else:
#                     st.error(response.json().get("detail", "Unknown error"))

with tab3:
    import json

    if "signers" not in st.session_state:
        st.session_state.signers = [{}]  # Start with one signer

    st.header("Multi-Signer: Upload Document")

   

    with st.form("multi_sign_upload"):
        file = st.file_uploader("Upload PDF", type=["pdf"])
        uuid = st.text_input("UUID")
        cs = st.text_input("Checksum (cs)")
        initiator_workid = st.text_input("Initiator Work ID")
        initiator_dept = st.text_input("Initiator Department")
        workflow_id = st.text_input("Workflow ID")

        st.subheader("Signer List")

        new_signers = []
        for i, signer in enumerate(st.session_state.signers):
            st.markdown(f"**Signer {i+1}**")
            signer_workid = st.text_input(f"Signer {i+1} Work ID", key=f"workid_{i}")
            signer_name = st.text_input(f"Signer {i+1} Name", key=f"name_{i}")
            signer_email = st.text_input(f"Signer {i+1} Email", key=f"email_{i}")

            locations = []
            loc_count = st.number_input(
                f"How many signature locations for Signer {i+1}?", min_value=1, max_value=5, step=1, key=f"loc_count_{i}"
            )
            for j in range(loc_count):
                col1, col2, col3 = st.columns(3)
                with col1:
                    page = st.number_input(f"Page #{j+1}", min_value=1, key=f"page_{i}_{j}")
                with col2:
                    x = st.number_input(f"X Pos #{j+1}", key=f"x_{i}_{j}")
                with col3:
                    y = st.number_input(f"Y Pos #{j+1}", key=f"y_{i}_{j}")
                locations.append({"page": int(page), "x": float(x), "y": float(y)})

            new_signers.append({
                "signer_workid": signer_workid,
                "signer_name": signer_name,
                "signer_email": signer_email,
                "locations": locations
            })

        submitted = st.form_submit_button("Upload and Create Multi-Sign Session")

        if submitted:
            if not file:
                st.error("Please upload a PDF file.")
            else:
                files = {"myfile": (file.name, file.getvalue(), "application/pdf")}
                data = {
                    "uuid": uuid,
                    "cs": cs,
                    "initiator_workid": initiator_workid,
                    "initiator_work_dept": initiator_dept,
                    "workflow_id": workflow_id,
                    "signerlist": json.dumps(new_signers)
                }
                response = requests.post(f"{BASE_URL}/multi-sign/upload", files=files, data=data)
                if response.status_code == 200:
                    st.success("Upload successful!")
                    st.write(response.json())
                else:
                    st.error(response.json().get("detail", "Unknown error"))

     # ➕ Button comes BEFORE the form
    if st.button("➕ Add Another Signer"):
        st.session_state.signers.append({})


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
