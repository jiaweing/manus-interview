// biome-ignore-all lint/style/useFilenamingConvention: Preserve the WXT React scaffold's component filename.
import { useCallback, useState } from "react";
import reactLogo from "@/assets/react.svg";
import wxtLogo from "/wxt.svg";

import "./App.css";

function App() {
	const [count, setCount] = useState(0);
	const increment = useCallback(() => setCount((previous) => previous + 1), []);

	return (
		<>
			<div>
				<a href="https://wxt.dev" rel="noopener" target="_blank">
					<img
						alt="WXT logo"
						className="logo"
						height={96}
						src={wxtLogo}
						width={96}
					/>
				</a>
				<a href="https://react.dev" rel="noopener" target="_blank">
					<img
						alt="React logo"
						className="logo react"
						height={96}
						src={reactLogo}
						width={108}
					/>
				</a>
			</div>
			<h1>WXT + React</h1>
			<div className="card">
				<button onClick={increment} type="button">
					count is {count}
				</button>
				<p>
					Edit <code>src/App.tsx</code> and save to test HMR
				</p>
			</div>
			<p className="read-the-docs">
				Click on the WXT and React logos to learn more
			</p>
		</>
	);
}

export default App;
