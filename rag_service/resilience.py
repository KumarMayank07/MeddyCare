# rag_service/resilience.py
"""
Fault-tolerance primitives: Circuit Breaker + retry helpers.

Circuit Breaker
───────────────
  Prevents cascading failures by short-circuiting calls to a service that
  has failed repeatedly.  Three states:
    CLOSED   → normal operation, failures counted
    OPEN     → calls rejected immediately (returns fallback / raises)
    HALF-OPEN→ one probe call allowed; success → CLOSED, failure → OPEN

Retry helper
────────────
  `with_retry` is a thin wrapper around tenacity that provides exponential
  backoff with jitter for transient errors (timeouts, rate-limits, 5xx).
"""

import logging
import time
import threading
from enum import Enum
from typing import Callable, Optional, Set, Type, TypeVar

from tenacity import (
    RetryCallState,
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")


# ── Circuit Breaker ──────────────────────────────────────────────────────────

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    """
    Simple in-memory circuit breaker.

    Args:
        name:              Human-readable name (used in logs).
        failure_threshold:  Consecutive failures before opening the circuit.
        recovery_timeout:   Seconds to wait in OPEN state before probing.
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout

        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_time: float = 0.0
        self._lock = threading.Lock()

    @property
    def state(self) -> CircuitState:
        with self._lock:
            if self._state == CircuitState.OPEN:
                if time.monotonic() - self._last_failure_time >= self.recovery_timeout:
                    self._state = CircuitState.HALF_OPEN
                    logger.info("[CircuitBreaker:%s] OPEN → HALF_OPEN (probing)", self.name)
            return self._state

    def record_success(self) -> None:
        with self._lock:
            self._failure_count = 0
            if self._state != CircuitState.CLOSED:
                logger.info("[CircuitBreaker:%s] %s → CLOSED", self.name, self._state.value)
                self._state = CircuitState.CLOSED

    def record_failure(self) -> None:
        with self._lock:
            self._failure_count += 1
            self._last_failure_time = time.monotonic()
            if self._failure_count >= self.failure_threshold:
                if self._state != CircuitState.OPEN:
                    logger.warning(
                        "[CircuitBreaker:%s] %s → OPEN after %d consecutive failures",
                        self.name, self._state.value, self._failure_count,
                    )
                self._state = CircuitState.OPEN

    def allow_request(self) -> bool:
        """Return True if the call should proceed, False to short-circuit."""
        current = self.state  # triggers OPEN→HALF_OPEN transition if timeout elapsed
        if current == CircuitState.CLOSED:
            return True
        if current == CircuitState.HALF_OPEN:
            return True  # allow one probe
        return False  # OPEN — reject


class CircuitOpenError(Exception):
    """Raised when the circuit breaker is OPEN and rejecting calls."""
    def __init__(self, breaker_name: str):
        super().__init__(f"Circuit breaker '{breaker_name}' is OPEN — service temporarily unavailable")
        self.breaker_name = breaker_name


# ── Pre-configured circuit breakers for external services ────────────────────

groq_breaker = CircuitBreaker("groq", failure_threshold=5, recovery_timeout=30)
embeddings_breaker = CircuitBreaker("google-embeddings", failure_threshold=5, recovery_timeout=30)


# ── Retry decorator factory ─────────────────────────────────────────────────

def _log_before_retry(retry_state: RetryCallState) -> None:
    logger.warning(
        "Retry attempt %d after error: %s",
        retry_state.attempt_number,
        retry_state.outcome.exception() if retry_state.outcome else "unknown",
    )


def with_retry(
    max_attempts: int = 3,
    retry_on: Optional[Set[Type[BaseException]]] = None,
) -> Callable:
    """
    Return a tenacity retry decorator with exponential backoff + jitter.

    Default retries on: Exception (excluding CircuitOpenError).
    Backoff: 1s → 2s → 4s (with ±jitter to avoid thundering herd).
    """
    if retry_on is None:
        retry_on = {Exception}

    def _should_retry(exc: BaseException) -> bool:
        if isinstance(exc, CircuitOpenError):
            return False
        return any(isinstance(exc, t) for t in retry_on)

    return retry(
        retry=retry_if_exception(_should_retry),
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential_jitter(initial=1, max=8, jitter=1),
        before_sleep=_log_before_retry,
        reraise=True,
    )
