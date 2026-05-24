"use client";

import { useEffect, useMemo, useState } from "react";

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  imageUrl: string;
  warehouses: WarehouseStock[];
};

type WarehouseStock = {
  warehouseId: string;
  code: string;
  name: string;
  city: string;
  totalUnits: number;
  reservedUnits: number;
  availableUnits: number;
};

type Reservation = {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  status: "pending" | "confirmed" | "released";
  expiresAt: string;
  product: { name: string; sku: string };
  warehouse: { name: string; city: string; code: string };
};

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function readApi<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.");
  }
  return data;
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [selectedWarehouse, setSelectedWarehouse] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadProducts() {
    setLoading(true);
    try {
      const nextProducts = await readApi<Product[]>(await fetch("/api/products"));
      setProducts(nextProducts);
      setSelectedWarehouse((current) => {
        const next = { ...current };
        for (const product of nextProducts) {
          next[product.id] ??= product.warehouses[0]?.warehouseId ?? "";
        }
        return next;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load products.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProducts();
  }, []);

  async function reserve(product: Product) {
    const warehouseId = selectedWarehouse[product.id];
    if (!warehouseId) return;

    setBusyId(product.id);
    setError(null);
    setMessage(null);

    try {
      const data = await readApi<{ reservation: Reservation }>(
        await fetch("/api/reservations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey("reserve"),
          },
          body: JSON.stringify({ productId: product.id, warehouseId, quantity: 1 }),
        }),
      );
      setReservation(data.reservation);
      setMessage("Reservation created. Complete checkout before the timer ends.");
      await loadProducts();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reserve stock.");
      await loadProducts();
    } finally {
      setBusyId(null);
    }
  }

  async function finish(action: "confirm" | "release") {
    if (!reservation) return;

    setBusyId(reservation.id);
    setError(null);
    setMessage(null);

    try {
      const data = await readApi<{ reservation: Reservation }>(
        await fetch(`/api/reservations/${reservation.id}/${action}`, {
          method: "POST",
          headers:
            action === "confirm"
              ? { "Idempotency-Key": idempotencyKey("confirm") }
              : undefined,
        }),
      );
      setReservation(data.reservation);
      setMessage(
        action === "confirm"
          ? "Purchase confirmed. Stock has been permanently decremented."
          : "Reservation cancelled. Stock is available again.",
      );
      await loadProducts();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout action failed.");
      await loadProducts();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main>
      <section className="topbar">
        <div>
          <p className="eyebrow">Allo fulfillment</p>
          <h1>Inventory reservations</h1>
        </div>
        <button className="ghost" onClick={() => void loadProducts()} disabled={loading}>
          Refresh
        </button>
      </section>

      {(message || error) && (
        <div className={error ? "notice error" : "notice"}>
          {error ?? message}
        </div>
      )}

      {reservation && (
        <ReservationPanel
          reservation={reservation}
          busy={busyId === reservation.id}
          onConfirm={() => void finish("confirm")}
          onCancel={() => void finish("release")}
        />
      )}

      <section className="inventory">
        {loading && products.length === 0 ? (
          <p className="muted">Loading inventory...</p>
        ) : (
          products.map((product) => {
            const selected = selectedWarehouse[product.id] ?? product.warehouses[0]?.warehouseId;
            const stock = product.warehouses.find(
              (warehouse) => warehouse.warehouseId === selected,
            );

            return (
              <article className="product-card" key={product.id}>
                <img src={product.imageUrl} alt="" />
                <div className="product-body">
                  <div>
                    <p className="sku">{product.sku}</p>
                    <h2>{product.name}</h2>
                    <p className="description">{product.description}</p>
                  </div>

                  <div className="stock-table">
                    {product.warehouses.map((warehouse) => (
                      <button
                        className={
                          warehouse.warehouseId === selected
                            ? "warehouse selected"
                            : "warehouse"
                        }
                        key={warehouse.warehouseId}
                        onClick={() =>
                          setSelectedWarehouse((current) => ({
                            ...current,
                            [product.id]: warehouse.warehouseId,
                          }))
                        }
                      >
                        <span>
                          {warehouse.name}
                          <small>{warehouse.city}</small>
                        </span>
                        <strong>{warehouse.availableUnits}</strong>
                      </button>
                    ))}
                  </div>

                  <div className="actions">
                    <p>
                      <strong>{stock?.availableUnits ?? 0}</strong> available at{" "}
                      {stock?.code ?? "warehouse"}
                    </p>
                    <button
                      onClick={() => void reserve(product)}
                      disabled={!stock || stock.availableUnits < 1 || busyId === product.id}
                    >
                      {busyId === product.id ? "Reserving..." : "Reserve"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}

function ReservationPanel({
  reservation,
  busy,
  onConfirm,
  onCancel,
}: {
  reservation: Reservation;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const remaining = useMemo(() => {
    return Math.max(0, new Date(reservation.expiresAt).getTime() - now);
  }, [now, reservation.expiresAt]);

  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  const isPending = reservation.status === "pending";

  return (
    <section className="checkout">
      <div>
        <p className="eyebrow">Checkout reservation</p>
        <h2>{reservation.product.name}</h2>
        <p>
          {reservation.quantity} unit from {reservation.warehouse.name},{" "}
          {reservation.warehouse.city}
        </p>
      </div>
      <div className="timer">
        <span>{reservation.status}</span>
        <strong>
          {minutes}:{seconds.toString().padStart(2, "0")}
        </strong>
      </div>
      <div className="checkout-actions">
        <button onClick={onConfirm} disabled={!isPending || busy || remaining === 0}>
          Confirm purchase
        </button>
        <button className="danger" onClick={onCancel} disabled={!isPending || busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}
