import warnings
warnings.simplefilter('always')

from main import DiscoveryResponse

def test():
    with warnings.catch_warnings(record=True) as w:
        print("Schema:")
        print(DiscoveryResponse.model_json_schema())
        print("---------")
        for warning in w:
            print(f"WARNING: {warning.message}")

test()
