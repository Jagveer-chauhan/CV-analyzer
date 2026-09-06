from huggingface_hub import InferenceClient

try:
    from config import settings
except ImportError:
    from backend.config import settings


def get_llm_client() -> InferenceClient:
    """Returns an InferenceClient instance configured with current settings."""
    return InferenceClient(
        model=settings.HUGGINGFACE_MODEL,
        token=settings.HUGGINGFACE_TOKEN if settings.HUGGINGFACE_TOKEN else None,
    )


# Default client instance
llm_client = get_llm_client()


def _ping_llm(client: InferenceClient = None) -> dict:
    """Send a lightweight request to the LLM to verify connectivity.

    Handles conversational (chat_completion with max_tokens) and falls back to
    text_generation if needed.
    """
    active_client = client or get_llm_client()

    # Try chat_completion first (required by conversational models like Gemma)
    try:
        response = active_client.chat_completion(
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=5,
        )
        if response and hasattr(response, "choices") and response.choices:
            return {"status": "ok", "details": "LLM responded successfully via chat_completion"}
        elif response:
            return {"status": "ok", "details": "LLM responded successfully"}
        return {"status": "error", "details": "Empty response from LLM"}
    except Exception as chat_exc:
        # Fallback to text_generation for models that only support text-generation
        try:
            response = active_client.text_generation("ping", max_new_tokens=5)
            if response:
                return {"status": "ok", "details": "LLM responded successfully via text_generation"}
            return {"status": "error", "details": "Empty response from LLM"}
        except Exception:
            return {
                "status": "error",
                "details": f"LLM connection failed: {chat_exc}",
            }


def check_llm_connection() -> dict:
    """Verify Hugging Face LLM integration settings and live connectivity."""
    if not settings.HUGGINGFACE_TOKEN:
        return {
            "status": "error",
            "message": "HUGGINGFACE_TOKEN environment variable is not set in backend/.env",
        }

    ping_result = _ping_llm()
    if ping_result["status"] != "ok":
        return {
            "status": "error",
            "message": ping_result.get("details", "Unknown connection error"),
        }

    return {
        "status": "configured",
        "model": settings.HUGGINGFACE_MODEL,
        "provider": "Hugging Face Inference API",
        "details": "LLM client connected and responding successfully",
    }
