We have skipped MIME detection of the uploaded file for now which needs to be added at a later stage to verify that the uploaded file in fact holds the extension it claims to hold 

Navigate to digitalsign_gateway folder

activate virtual env using - myenv\Scripts\activate

Run -> uvicorn final:app --reload