from engine.derush.providers.base import VisionAnalysisProvider  # noqa: F401
from engine.derush.providers.heuristic import HeuristicProvider   # noqa: F401
from engine.derush.providers.mock import MockProvider             # noqa: F401


def get_provider(name: str, config: dict) -> VisionAnalysisProvider:
    """Factory: returns a configured provider by name."""
    if name == "heuristic" or not name:
        return HeuristicProvider()
    if name == "mock":
        return MockProvider()
    if name == "gemini":
        from engine.derush.providers.gemini import GeminiProvider
        return GeminiProvider(api_key=config.get("api_key", ""))
    # Future providers:
    # if name == "openai":
    #     from engine.derush.providers.openai import OpenAIProvider
    #     return OpenAIProvider(api_key=config.get("api_key", ""))
    # if name == "claude":
    #     from engine.derush.providers.claude import ClaudeProvider
    #     return ClaudeProvider(api_key=config.get("api_key", ""))
    raise ValueError(f"Unknown vision provider: {name!r}")
