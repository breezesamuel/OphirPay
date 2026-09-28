"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { format } from "date-fns";

interface DeadLetterItem {
  id: string;
  eventType: string;
  targetUrl: string;
  errorMessage: string | null;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface DeadLetterResponse {
  items: DeadLetterItem[];
  pagination: Pagination;
}

export default function WebhookDeadLetterPage() {
  const router = useRouter();
  const params = useParams();
  const webhookId = params.id as string;
  const [items, setItems] = useState<DeadLetterItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "resolved" | "unresolved">("unresolved");

  const fetchItems = async (page = 1) => {
    setLoading(true);
    try {
      const searchParams = new URLSearchParams({
        page: page.toString(),
        limit: "20",
      });
      if (filter === "resolved") searchParams.set("resolved", "true");
      else if (filter === "unresolved") searchParams.set("resolved", "false");

      const res = await fetch(`/api/webhooks/${webhookId}/dead-letter?${searchParams}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data: DeadLetterResponse = await res.json();
      setItems(data.items);
      setPagination(data.pagination);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems(1);
  }, [webhookId, filter]);

  const handleRedeliver = async (dlId: string) => {
    try {
      const res = await fetch(`/api/webhooks/${webhookId}/dead-letter/${dlId}/redeliver`, {
        method: "POST",
      });
      if (res.ok) {
        fetchItems(pagination.page);
      } else {
        alert("Redelivery failed");
      }
    } catch (err) {
      console.error(err);
      alert("Redelivery error");
    }
  };

  const handleResolve = async (dlId: string, resolution: "discarded" | "ignored") => {
    if (!confirm(`Mark as ${resolution}?`)) return;
    try {
      const res = await fetch(`/api/webhooks/${webhookId}/dead-letter/${dlId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      if (res.ok) {
        fetchItems(pagination.page);
      } else {
        alert("Failed to resolve");
      }
    } catch (err) {
      console.error(err);
      alert("Error");
    }
  };

  const statusBadge = (item: DeadLetterItem) => {
    if (item.resolvedAt) {
      return <span className="badge badge-success">{item.resolution}</span>;
    }
    return <span className="badge badge-warning">Pending</span>;
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dead Letter Queue</h1>
        <div className="flex gap-2">
          {["all", "unresolved", "resolved"].map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f as any); fetchItems(1); }}
              className={`px-3 py-1 rounded text-sm ${filter === f ? "bg-primary text-primary-content" : "bg-base-200"}`}
            >
              {f === "all" ? "All" : f === "resolved" ? "Resolved" : "Unresolved"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading loading-spinner loading-lg" />
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-base-content/60">No dead-letter entries</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="table table-zebra w-full">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Target URL</th>
                  <th>Error</th>
                  <th>Attempts</th>
                  <th>Status Code</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="font-mono text-sm">{item.eventType}</td>
                    <td className="max-w-xs truncate">{item.targetUrl}</td>
                    <td className="max-w-md truncate text-base-content/70">{item.errorMessage || item.lastError || "Unknown"}</td>
                    <td>{item.attempts}</td>
                    <td>{item.lastStatusCode ?? "—"}</td>
                    <td className="text-sm">{format(new Date(item.createdAt), "MMM d, yyyy HH:mm")}</td>
                    <td>{statusBadge(item)}</td>
                    <td>
                      <div className="flex gap-1">
                        {!item.resolvedAt && (
                          <button
                            onClick={() => handleRedeliver(item.id)}
                            className="btn btn-sm btn-primary"
                            disabled={loading}
                          >
                            Redeliver
                          </button>
                        )}
                        {!item.resolvedAt && (
                          <div className="dropdown dropdown-end">
                            <button className="btn btn-sm btn-ghost" tabIndex={0}>Resolve ▾</button>
                            <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-40">
                              <li onClick={() => handleResolve(item.id, "redelivered")}><a>Mark Redelivered</a></li>
                              <li onClick={() => handleResolve(item.id, "discarded")}><a>Discard</a></li>
                              <li onClick={() => handleResolve(item.id, "ignored")}><a>Ignore</a></li>
                            </ul>
                          </div>
                        )}
                        {item.resolvedAt && (
                          <span className="text-xs text-base-content/60">Resolved: {item.resolution}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                onClick={() => fetchItems(pagination.page - 1)}
                disabled={pagination.page === 1 || loading}
                className="btn btn-sm"
              >
                Prev
              </button>
              <span className="flex items-center px-3">Page {pagination.page} / {pagination.totalPages}</span>
              <button
                onClick={() => fetchItems(pagination.page + 1)}
                disabled={pagination.page === pagination.totalPages || loading}
                className="btn btn-sm"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}