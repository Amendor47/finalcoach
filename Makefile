run:
    uvicorn server.app:app --host 127.0.0.1 --port 3002 --reload

test:
    pytest -q
