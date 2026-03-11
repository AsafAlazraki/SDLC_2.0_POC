import database

print("Testing Supabase...")
try:
    clients = database.get_clients()
    print("Clients:", clients)
except Exception as e:
    print("Error:", e)
