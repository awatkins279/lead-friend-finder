import { createFileRoute } from "@tanstack/react-router";
import { OrderAccounts } from "@/components/OrderAccounts";

export const Route = createFileRoute("/app/order")({
  component: OrderRoute,
  head: () => ({ meta: [{ title: "Order email accounts — NexusAi" }] }),
});

function OrderRoute() {
  return (
    <div className="p-8">
      <OrderAccounts />
    </div>
  );
}
