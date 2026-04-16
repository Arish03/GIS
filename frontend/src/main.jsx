import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.875rem',
        },
        success: { iconTheme: { primary: 'var(--accent-green)', secondary: '#fff' } },
        error: { iconTheme: { primary: 'var(--accent-red)', secondary: '#fff' } },
      }}
    />
  </React.StrictMode>
);
