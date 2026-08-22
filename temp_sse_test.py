import requests

url = 'http://localhost:5000/api/chat/stream'
headers = {'Content-Type': 'application/json'}
payload = {'message': 'test', 'mode': 'standard'}

with requests.post(url, headers=headers, json=payload, stream=True, timeout=30) as response:
    print('STATUS', response.status_code, response.headers.get('content-type'))
    count = 0
    for line in response.iter_lines(decode_unicode=True):
        if line:
            print(repr(line))
            count += 1
        if count >= 40:
            break
