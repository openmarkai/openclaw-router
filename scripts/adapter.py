"""
Translates OpenMark AI model identifiers to OpenClaw model identifiers.

Primary path: The CSV contains two key columns:
  - "OC Key": the direct provider model key (e.g., "openai/gpt-5.4",
    "together/moonshotai/Kimi-K2.5")
  - "OC OR Key": the OpenRouter model key (e.g., "openrouter/openai/gpt-5.4",
    "openrouter/moonshotai/kimi-k2.5")

The router tries OC Key first (direct provider). If that provider isn't
configured, it falls back to OC OR Key (OpenRouter). No name translation,
no fuzzy matching -- both keys come directly from the model registry.

Fallback path (older CSVs without OC Key / OC OR Key): The "Provider"
column is mapped via PROVIDER_MAP. Only works for self-hosted providers.
"""

# Fallback map for older CSVs without OC Key columns.
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


def _extract_provider(key: str) -> str | None:
    """Extract the top-level provider prefix from a model key."""
    if key and "/" in key:
        return key.split("/")[0]
    return None


def resolve_model_key(
    oc_key: str | None,
    oc_or_key: str | None,
    available_providers: set,
) -> str | None:
    """
    Resolve the best usable model key based on available providers.
    Tries the direct key first, then falls back to OpenRouter.
    """
    if oc_key:
        provider = _extract_provider(oc_key)
        if provider and provider in available_providers:
            return oc_key

    if oc_or_key and "openrouter" in available_providers:
        return oc_or_key

    return None


def to_openclaw_id(provider: str, model: str) -> str:
    """
    Fallback: Convert OpenMark provider + model to OpenClaw 'provider/model'.
    Used only when OC Key columns are not present in the CSV.
    """
    provider_lower = provider.strip().lower()
    prefix = PROVIDER_MAP.get(provider_lower, provider_lower)
    return f"{prefix}/{model.strip()}"


def get_openclaw_provider(openmark_provider: str) -> str:
    """Fallback: Get the OpenClaw provider prefix for an OpenMark provider."""
    return PROVIDER_MAP.get(
        openmark_provider.strip().lower(),
        openmark_provider.strip().lower(),
    )
