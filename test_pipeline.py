def test_config_loads():
    from server.config_loader import AppConfig
    cfg = AppConfig.load().data
    assert "embeddings" in cfg and "vectorstore" in cfg

def test_embed_roundtrip(tmp_path):
    from server.embeddings.factory import EmbeddingFactory
    from server.vectorstores.faiss_store import FAISSStore
    E = EmbeddingFactory("sentence-transformers/all-MiniLM-L6-v2")
    VS = FAISSStore(str(tmp_path)); VS.load(E.encode(["x"]).shape[1])
    VS.add(E.encode(["hello"]), [{"text":"hello"}])
    hits = VS.search(E.encode(["hello"]), k=1)
    assert hits and VS.get(hits[0][0])["text"] == "hello"
