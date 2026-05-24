"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Product = {
  id: string;
  name: string;
  sku: string;
  description: string;
  warehouses: Array<{
    stockLevelId: string;
    totalUnits: number;
    reservedUnits: number;
    availableUnits: number;
    warehouse: {
      id: string;
      name: string;
      code: string;
      city: string;
    };
  }>;
};

type ApiErrorBody = {
  error?: string;
  code?: string;
};

async function readApiError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  return body.error ?? `Request failed with status ${response.status}`;
}

export function InventoryApp() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reservingKey, setReservingKey] = useState<string | null>(null);

  async function loadProducts() {
    setError(null);
    const response = await fetch("/api/products", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const body = (await response.json()) as { products: Product[] };
    setProducts(body.products);
  }

  useEffect(() => {
    loadProducts()
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    return products.reduce(
      (summary, product) => {
        for (const item of product.warehouses) {
          summary.available += item.availableUnits;
          summary.reserved += item.reservedUnits;
          summary.total += item.totalUnits;
        }
        return summary;
      },
      { available: 0, reserved: 0, total: 0 },
    );
  }, [products]);

  async function reserve(productId: string, warehouseId: string, key: string) {
    setError(null);
    setReservingKey(key);

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ productId, warehouseId, quantity: 1 }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const body = (await response.json()) as { reservation: { id: string } };
      router.push(`/reservations/${body.reservation.id}`);
    } catch (reserveError) {
      setError(reserveError instanceof Error ? reserveError.message : "Reservation failed.");
      await loadProducts().catch(() => undefined);
    } finally {
      setReservingKey(null);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Allo checkout inventory</p>
          <h1>Warehouse stock reservations</h1>
        </div>
        <button className="ghost-button" onClick={() => loadProducts()} disabled={loading}>
          Refresh
        </button>
      </header>

      <section className="metric-row" aria-label="Inventory summary">
        <div>
          <span>Available</span>
          <strong>{totals.available}</strong>
        </div>
        <div>
          <span>Reserved</span>
          <strong>{totals.reserved}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong>{totals.total}</strong>
        </div>
      </section>

      {error ? <div className="alert">{error}</div> : null}
      {loading ? <div className="panel">Loading inventory...</div> : null}

      <section className="product-grid" aria-label="Products">
        {products.map((product) => (
          <article className="product-card" key={product.id}>
            <div className="product-heading">
              <div>
                <h2>{product.name}</h2>
                <p>{product.description}</p>
              </div>
              <span className="sku">{product.sku}</span>
            </div>

            <div className="stock-table">
              <div className="stock-row stock-head">
                <span>Warehouse</span>
                <span>Total</span>
                <span>Held</span>
                <span>Available</span>
                <span />
              </div>

              {product.warehouses.map((item) => {
                const key = `${product.id}-${item.warehouse.id}`;
                const disabled = item.availableUnits <= 0 || reservingKey === key;

                return (
                  <div className="stock-row" key={item.stockLevelId}>
                    <span>
                      <strong>{item.warehouse.code}</strong>
                      <small>{item.warehouse.city}</small>
                    </span>
                    <span>{item.totalUnits}</span>
                    <span>{item.reservedUnits}</span>
                    <span className={item.availableUnits <= 0 ? "empty" : ""}>
                      {item.availableUnits}
                    </span>
                    <button
                      className="primary-button"
                      disabled={disabled}
                      onClick={() => reserve(product.id, item.warehouse.id, key)}
                    >
                      {reservingKey === key ? "Holding" : "Reserve"}
                    </button>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
