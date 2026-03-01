import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import ContactUsPage from './pages/ContactUsPage';
import LoadFlowStudyPage from './pages/LoadFlowStudyPage';

const studyTabs = [
  { label: 'Load Flow', to: '/studies/load-flow' },
  { label: 'Short Circuit', to: '/studies/short-circuit' },
  { label: 'Protection Coordination', to: '/studies/protection-coordination' }
];

function TopNavigation() {
  return (
    <header className="top-nav">
      <div className="top-nav__brand">OpenPower Studio</div>
      <nav className="top-nav__tabs" aria-label="Power system studies">
        {studyTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `top-nav__tab${isActive ? ' top-nav__tab--active' : ''}`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <NavLink
        to="/contact"
        className={({ isActive }) =>
          `top-nav__contact${isActive ? ' top-nav__contact--active' : ''}`
        }
      >
        Contact Us
      </NavLink>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <TopNavigation />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Navigate to="/studies/load-flow" replace />} />
            <Route path="/studies/load-flow" element={<LoadFlowStudyPage studyType="loadflow" />} />
            <Route
              path="/studies/short-circuit"
              element={<LoadFlowStudyPage studyType="shortcircuit" />}
            />
            <Route
              path="/studies/protection-coordination"
              element={<LoadFlowStudyPage studyType="protection" />}
            />
            <Route path="/contact" element={<ContactUsPage />} />
            <Route path="*" element={<Navigate to="/studies/load-flow" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
