import os
import json
from google import genai
from google.genai import types
from main import DiscoveryResponse

# Use dummy key, see if we get validation error or API error
api_key = os.environ.get("GEMINI_API_KEY", "dummy")
client = genai.Client(api_key=api_key)

try:
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents="Hello",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=DiscoveryResponse,
            temperature=0.2
        ),
    )
    print(response.text)
except Exception as e:
    print(f"ERROR: {e}")
