import App from "@/components/App";
import AuthGate from "@/components/AuthGate";

export default function Page() {
  return (
    <AuthGate>
      <App />
    </AuthGate>
  );
}
