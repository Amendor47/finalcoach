from __future__ import annotations
from typing import Iterable
from .base import BaseLLMProvider

class CTransformersProvider(BaseLLMProvider):
    def __init__(self, model: str, model_file: str | None, model_type: str, config: dict):
        from ctransformers import AutoModelForCausalLM
        kwargs = {"model": model, "model_type": model_type}
        if model_file: kwargs["model_file"] = model_file
        if config: kwargs.update(config)
        self._model = AutoModelForCausalLM.from_pretrained(**kwargs)

    def generate(self, prompt: str, **params) -> str:
        return self._model(prompt, **params)

    def stream(self, prompt: str, **params) -> Iterable[str]:
        yield from self._model(prompt, stream=True, **params)
