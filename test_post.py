import requests

url = "http://localhost:8000/api/analyze"
data = {"apiKey": "invalid", "text_context": "hello"}
files = [("files", ("dummy.txt", b"hello world", "text/plain"))]

response = requests.post(url, data=data, files=files)
print(response.status_code)
print(response.text)
