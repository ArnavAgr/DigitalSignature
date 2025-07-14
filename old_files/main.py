from fastapi import FastAPI, File, UploadFile, HTTPException 
import os
import shutil
from datetime import datetime

app = FastAPI()

UPLOAD_DIR = "uploads"

@app.get("/")

def hello():
    return {"message": "Hello, Signing Gateway is live"}

@app.post("/sign/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files allowed")
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    saved_filename = f"{timestamp}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, saved_filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

        return {"message" : "File uploaded successfully", "file_path": file_path}