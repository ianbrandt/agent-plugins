def parse(text):
    values = {}
    for line in text.splitlines():
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values
