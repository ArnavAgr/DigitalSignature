import fitz
import os

pdf_path = "Sign_me.pdf"

def find_keyword_position(pdf_path, keyword):
    

    if not os.path.exists(pdf_path):
        print(f"Error: PDF file not found at {pdf_path}")
        return None

    try:
        doc = fitz.open(pdf_path)
        

        for page_num in range(len(doc)):
            page = doc[page_num]
            

            text_instances = page.search_for(keyword)

            if text_instances:
                print(f"Found '{keyword}' on page {page_num + 1}!")
                # Return first match: (x, y) of bottom-left
                rect = text_instances[0]
                x, y = rect.x0, rect.y0
                print(f"Position: x={x}, y={y}")
                doc.close()
                return {"page": page_num, "x": x, "y": y}
           

        doc.close() # Ensure the document is closed if keyword not found
        print(f"'{keyword}' not found in the entire document.")
        return None

    except Exception as e:
        print(f"An error occurred while processing the PDF: {e}")
        return None
