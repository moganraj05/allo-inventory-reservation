"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Reservation = {
  id: string;
  quantity: number;
  status: "PENDING" | "CONFIRMED" | "RELEASED";
  expiresAt: string;
  confirmedAt: string | null;
  releasedAt: string | null;
  product: {
    name: string;
    sku: string;
  };
  warehouse: {
    name: string;
    code: string;
    city: string;
  };
};

type ApiErrorBody = {
  error?: string;
};

async function readApiError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  return body.error ?? `Request failed with status ${response.status}`;
}

function formatRemaining(ms: number) {
  if (ms <= 0) {
    return "00:00";
  }

  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function ReservationDetail({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"confirm" | "release" | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);

  const loadReservation = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/reservations/${reservationId}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const body = (await response.json()) as { reservation: Reservation };
    setReservation(body.reservation);
  }, [reservationId]);

  useEffect(() => {
    loadReservation().catch((loadError: Error) => setError(loadError.message));
  }, [loadReservation]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (showSuccess || showCancelled) {
      const redirectTimer = window.setTimeout(() => {
        router.push("/");
      }, 1500);
      return () => window.clearTimeout(redirectTimer);
    }
  }, [showSuccess, showCancelled, router]);

  const remainingMs = useMemo(() => {
    if (!reservation) {
      return 0;
    }

    return new Date(reservation.expiresAt).getTime() - now;
  }, [now, reservation]);

  async function postAction(action: "confirm" | "release") {
    setError(null);
    setBusyAction(action);

    try {
      const response = await fetch(`/api/reservations/${reservationId}/${action}`, {
        method: "POST",
        headers:
          action === "confirm"
            ? { "Idempotency-Key": `confirm-${reservationId}` }
            : undefined,
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const body = (await response.json()) as { reservation: Reservation };
      setReservation(body.reservation);

      if (action === "confirm") {
        setShowSuccess(true);
      } else if (action === "release") {
        setShowCancelled(true);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed.");
      await loadReservation().catch(() => undefined);
    } finally {
      setBusyAction(null);
    }
  }

  if (showSuccess) {
    return (
      <main className="shell narrow">
        <div className="success-popup">
          <div className="success-content">
            <div className="success-icon">✓</div>
            <h2>Purchase Confirmed!</h2>
            <p>Your reservation has been confirmed successfully.</p>
            <p className="small">Redirecting back...</p>
          </div>
        </div>
      </main>
    );
  }

  if (showCancelled) {
    return (
      <main className="shell narrow">
        <div className="success-popup">
          <div className="success-content">
            <div className="cancelled-icon">✕</div>
            <h2>Reservation Cancelled</h2>
            <p>Your reservation has been released. Units returned to inventory.</p>
            <p className="small">Redirecting back...</p>
          </div>
        </div>
      </main>
    );
  }

  if (!reservation) {
    return (
      <main className="shell narrow">
        <Link href="/" className="back-link">
          Back to products
        </Link>
        {error ? <div className="alert">{error}</div> : <div className="panel">Loading reservation...</div>}
      </main>
    );
  }

  const isPending = reservation.status === "PENDING";
  const expired = remainingMs <= 0;

  return (
    <main className="shell narrow">
      <Link href="/" className="back-link">
        Back to products
      </Link>

      <section className="checkout-panel">
        <div className="checkout-header">
          <div>
            <p className="eyebrow">Reservation {reservation.id.slice(-6)}</p>
            <h1>{reservation.product.name}</h1>
            <p>{reservation.product.sku}</p>
          </div>
          <span className={`status ${reservation.status.toLowerCase()}`}>
            {reservation.status.toLowerCase()}
          </span>
        </div>

        <div className="countdown" aria-live="polite">
          <span>Expires in</span>
          <strong>{isPending ? formatRemaining(remainingMs) : "--:--"}</strong>
        </div>

        {expired && isPending ? (
          <div className="alert">This hold has expired. Confirming now will return a 410.</div>
        ) : null}
        {error ? <div className="alert">{error}</div> : null}

        <dl className="details-list">
          <div>
            <dt>Quantity</dt>
            <dd>{reservation.quantity}</dd>
          </div>
          <div>
            <dt>Warehouse</dt>
            <dd>
              {reservation.warehouse.code} - {reservation.warehouse.city}
            </dd>
          </div>
          <div>
            <dt>Expires at</dt>
            <dd>{new Date(reservation.expiresAt).toLocaleString()}</dd>
          </div>
        </dl>

        <div className="actions">
          <button
            className="primary-button large"
            disabled={!isPending || busyAction !== null}
            onClick={() => postAction("confirm")}
          >
            {busyAction === "confirm" ? "Confirming" : "Confirm purchase"}
          </button>
          <button
            className="danger-button"
            disabled={!isPending || busyAction !== null}
            onClick={() => postAction("release")}
          >
            {busyAction === "release" ? "Cancelling" : "Cancel"}
          </button>
        </div>
      </section>
    </main>
  );
}
