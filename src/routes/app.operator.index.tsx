import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createOperatorThread, listOperatorThreads } from "@/lib/operator.functions";

export const Route = createFileRoute("/app/operator/")({ component: OperatorIndex });

function OperatorIndex() {
  const navigate = useNavigate();
  const listThreads = useServerFn(listOperatorThreads);
  const createThread = useServerFn(createOperatorThread);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const { threads } = await listThreads();
      const thread = threads[0] ?? (await createThread({ data: { title: "New campaign plan" } })).thread;
      await navigate({ to: "/app/operator/$threadId", params: { threadId: thread.id }, replace: true });
    })();
  }, [createThread, listThreads, navigate]);
  return <div className="grid h-[calc(100vh-2rem)] place-items-center text-sm text-muted-foreground">Preparing your Operator…</div>;
}