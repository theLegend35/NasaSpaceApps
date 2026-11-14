import truststore

# Use the operating system's certificate store for every outbound HTTPS call
# (the API, precache and the cron all import this package). Works behind
# campus/corporate TLS proxies that Python's bundled CA list doesn't know.
truststore.inject_into_ssl()
