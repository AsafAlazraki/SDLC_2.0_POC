import warnings
warnings.simplefilter('always')

from google.genai import types
from main import DiscoveryResponse

def test():
    with warnings.catch_warnings(record=True) as w:
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=DiscoveryResponse,
            temperature=0.2
        )
        print("Config created.")
        for warning in w:
            print(f"WARNING: {warning.message}")

test()
