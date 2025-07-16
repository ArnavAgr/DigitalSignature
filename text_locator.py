import fitz
import os

pdf_path = "Sign_me.pdf"

def find_keyword_position(pdf_path, keyword):
    print(f"Attempting to open PDF: {pdf_path}")

    if not os.path.exists(pdf_path):
        print(f"Error: PDF file not found at {pdf_path}")
        return None

    try:
        doc = fitz.open(pdf_path)
        print(f"PDF opened successfully. Number of pages: {len(doc)}")

        for page_num in range(len(doc)):
            page = doc[page_num]
            print(f"\n--- Text extracted from Page {page_num + 1} ---")
            extracted_text = page.get_text()
            print(extracted_text) # This will print all extracted text from the current page
            print(f"----------------------------------------\n")

            text_instances = page.search_for(keyword)

            if text_instances:
                print(f"Found '{keyword}' on page {page_num + 1}!")
                # Return first match: (x, y) of bottom-left
                rect = text_instances[0]
                x, y = rect.x0, rect.y0
                print(f"Position: x={x}, y={y}")
                doc.close()
                return {"page": page_num, "x": x, "y": y}
            else:
                pass # No need for a print here if you're already printing all text

        doc.close() # Ensure the document is closed if keyword not found
        print(f"'{keyword}' not found in the entire document.")
        return None

    except Exception as e:
        print(f"An error occurred while processing the PDF: {e}")
        return None

# Example Usage:
keyword_to_find = "Authorised Signature Here" # Using your current search keyword
position = find_keyword_position(pdf_path, keyword_to_find)

if position:
    print(f"\nKeyword found at: Page {position['page'] + 1}, X: {position['x']}, Y: {position['y']}")
else:
    print("\nKeyword not found in the PDF.")
