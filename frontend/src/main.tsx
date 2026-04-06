import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles/base.css';
import './styles/themes.css';
import './styles/layout.css';
import '@xyflow/react/dist/style.css';
import './styles/reactflow.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
