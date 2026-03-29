"""
Translates OpenMark AI model identifiers to OpenClaw model identifiers.

OpenMark uses short IDs without provider prefix (e.g., "gemini-3-flash").
OpenClaw uses provider-prefixed IDs (e.g., "google/gemini-3-flash").
The CSV "Provider" column maps to the OpenClaw provider prefix.
"""

PROVIDER_MAP = {
    "openai": "openai",
    "anthropic": "anthropic",
    "gemini": "google",
    "deepseek": "deepseek",
    "mistral": "mistral",
    "cohere": "cohere",
    "xai": "xai",
    "qwen": "qwen",
    "zhipu": "zhipu",
    "moonshot_ai": "moonshot",
    "minimax": "minimax",
    "deepcogito": "deepcogito",
    "groq": "groq",
    "together": "together",
    "nvidia": "nvidia",
    "perplexity": "perplexity",
}


def to_openclaw_id(provider: str, model: str) -> str:
    """Convert OpenMark provider + model to OpenClaw 'provider/model' format."""
    provider_lower = provider.strip().lower()
    prefix = PROVIDER_MAP.get(provider_lower, provider_lower)
    return f"{prefix}/{model.strip()}"


def get_openclaw_provider(openmark_provider: str) -> str:
    """Get the OpenClaw provider prefix for an OpenMark provider name."""
    provider_lower = openmark_provider.strip().lower()
    return PROVIDER_MAP.get(provider_lower, provider_lower)


def is_known_provider(provider: str) -> bool:
    """Check if a provider has an explicit mapping."""
    return provider.strip().lower() in PROVIDER_MAP
