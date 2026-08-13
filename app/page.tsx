import type { Metadata } from "next";
import RoughcutWorkspace from "./RoughcutWorkspace";

export const metadata: Metadata = {
  title: "Roughcut — Talking-head edit review",
  description: "Review word-safe pause, repetition, and retake cuts before exporting an EDL.",
};

export default function Home() {
  return <RoughcutWorkspace />;
}
