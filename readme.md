# What is this application?

It's a server wrapper for external KSEF pdf generation library. Based on version 1.1.40 of that library
Original repository: https://github.com/CIRFMF/ksef-pdf-generator


# How to use it?

Set it up - using documentation presented in doc/. Then you can use it as server

## Example testing:

curl -X POST http://localhost:7321/api/v1/invoices/pdf \
  -F "file=@/path/to/invoice.xml" \
  -F "nrKSeF=5555555555-20250808-9231003CA67B-BE" \
  -o invoice.pdf 
