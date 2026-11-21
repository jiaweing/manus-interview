import { IngressProbe } from "./ingress-probe";

export default function Home() {
	return (
		<main className="mx-auto max-w-3xl px-6 py-16">
			<h1 className="font-semibold text-3xl tracking-tight">Flopside</h1>
			<p className="mt-4">The Next.js scaffold is running.</p>
			<p className="mt-2">Poker rooms and gameplay are not implemented yet.</p>
			<IngressProbe />
		</main>
	);
}
