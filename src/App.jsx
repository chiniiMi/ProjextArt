import { useEffect, useState } from 'react';

const categories = ['All work', 'Painting', 'Print', 'Drawing'];

function App() {
  const [artworks, setArtworks] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All work');
  const [selectedArtwork, setSelectedArtwork] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    fetch('/api/artworks')
      .then((response) => {
        if (!response.ok) throw new Error('The gallery could not be loaded.');
        return response.json();
      })
      .then((data) => {
        if (active) setArtworks(data);
      })
      .catch(() => {
        if (active) setError('The gallery is having a moment. Please refresh to try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedArtwork) return undefined;

    function closeOnEscape(event) {
      if (event.key === 'Escape') setSelectedArtwork(null);
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedArtwork]);

  const visibleArtworks = artworks.filter((artwork) => (
    activeCategory === 'All work' || artwork.category === activeCategory
  ));

  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#home" aria-label="Mira Sol home">mira<span>sol</span><i>.</i></a>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#work">Work</a>
          <a href="#about">About</a>
          <a className="nav-contact" href="mailto:hello@mirasol.studio">Get in touch <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <section className="hero" id="home">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> Independent artist & illustrator</p>
          <h1>Art for the<br />in-between <em>moments.</em></h1>
          <div className="hero-bottom">
            <p>Making images about memory, nature, and the small things that stay with us.</p>
            <a className="round-link" href="#work" aria-label="Explore selected work"><span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="hero-art" role="img" aria-label="Colorful abstract painting in a sunlit studio">
          <div className="hero-art-label"><span>01 / 04</span><span>STUDIES IN COLOR, 2025</span></div>
        </div>
        <span className="hero-side-note">ARTIST PORTFOLIO <span>—</span> 2025</span>
      </section>

      <section className="work-section" id="work">
        <div className="section-heading">
          <div>
            <p className="eyebrow">A few things I made</p>
            <h2>Selected work<span className="accent-dot">.</span></h2>
          </div>
          <span className="work-count">2024 — 2025</span>
        </div>

        <div className="filter-row" role="group" aria-label="Filter artwork by category">
          {categories.map((category) => (
            <button
              className={activeCategory === category ? 'filter-button active' : 'filter-button'}
              key={category}
              type="button"
              aria-pressed={activeCategory === category}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        {loading && <p className="gallery-message" role="status">Gathering the work...</p>}
        {error && <p className="gallery-message" role="alert">{error}</p>}
        {!loading && !error && (
          <div className="art-grid">
            {visibleArtworks.map((artwork, index) => (
              <button
                className={`artwork-card ${artwork.shape}`}
                key={artwork.id}
                type="button"
                onClick={() => setSelectedArtwork(artwork)}
                aria-label={`View ${artwork.title}, ${artwork.category}, ${artwork.year}`}
                style={{ '--delay': `${index * 80}ms` }}
              >
                <span className="artwork-image-wrap">
                  <img src={artwork.image} alt={artwork.alt} loading="lazy" />
                  <span className="artwork-open" aria-hidden="true">↗</span>
                </span>
                <span className="artwork-meta">
                  <span><strong>{artwork.title}</strong><small>{artwork.category}</small></span>
                  <span className="artwork-year">{artwork.year}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="about-section" id="about">
        <div className="about-index">A LITTLE<br />ABOUT ME <span>↘</span></div>
        <div className="about-copy">
          <p className="eyebrow">Based in Portland, Oregon</p>
          <h2>Curiosity is a<br />pretty good <em>compass.</em></h2>
          <p className="about-description">I’m Mira, an artist working across painting, print, and illustration. My practice starts with looking closely: at a landscape, a passing feeling, or the way light lands on an ordinary afternoon.</p>
          <a className="text-link" href="mailto:hello@mirasol.studio">Say hello <span aria-hidden="true">↗</span></a>
        </div>
        <div className="about-mark" aria-hidden="true">m.</div>
      </section>

      <footer className="site-footer">
        <a className="wordmark" href="#home">mira<span>sol</span><i>.</i></a>
        <span>Independent artist & illustrator</span>
        <a href="mailto:hello@mirasol.studio">hello@mirasol.studio <span aria-hidden="true">↗</span></a>
        <span>© 2025 Mira Sol</span>
      </footer>

      {selectedArtwork && (
        <div className="dialog-backdrop" onClick={() => setSelectedArtwork(null)}>
          <section
            className="artwork-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="dialog-close" type="button" onClick={() => setSelectedArtwork(null)} aria-label="Close artwork details">×</button>
            <img src={selectedArtwork.image} alt={selectedArtwork.alt} />
            <div className="dialog-copy">
              <p className="eyebrow">{selectedArtwork.category} <span>·</span> {selectedArtwork.year}</p>
              <h2 id="dialog-title">{selectedArtwork.title}</h2>
              <p>{selectedArtwork.medium}</p>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;