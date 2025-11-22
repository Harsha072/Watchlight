import { useState, useEffect } from 'react'
import Head from 'next/head'

export default function Home() {
  const [healthStatus, setHealthStatus] = useState<string>('checking...')

  useEffect(() => {
    // TODO: Fetch health status from gateway service
    fetch('http://localhost:3000/health')
      .then(res => res.json())
      .then(data => setHealthStatus(data.status))
      .catch(() => setHealthStatus('error'))
  }, [])

  return (
    <>
      <Head>
        <title>Watchlight - API Observability Mesh</title>
        <meta name="description" content="API Observability Dashboard" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className="container">
        <h1>Watchlight - API Observability Mesh</h1>
        <div className="status">
          <p>Gateway Status: <span className={healthStatus}>{healthStatus}</span></p>
        </div>
        <div className="dashboard">
          <h2>Dashboard</h2>
          <p>TODO: Implement observability dashboard</p>
          <ul>
            <li>Metrics visualization</li>
            <li>Logs viewer</li>
            <li>Trace explorer</li>
            <li>AI insights</li>
          </ul>
        </div>
      </main>
    </>
  )
}

