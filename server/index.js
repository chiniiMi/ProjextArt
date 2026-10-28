import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = process.env.PORT || 3001;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(currentDirectory, '..');

const artworks = [
  {
    id: 'blue-hour',
    title: 'The Blue Hour',
    category: 'Painting',
    year: '2025',
    medium: 'Oil and cold wax on linen',
    image: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&w=1200&q=85',
    alt: 'Expressive painted portrait in deep blue and warm red tones',
    shape: 'portrait',
  },
  {
    id: 'soft-geometry',
    title: 'Soft Geometry',
    category: 'Print',
    year: '2025',
    medium: 'Archival pigment print',
    image: 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?auto=format&fit=crop&w=1200&q=85',
    alt: 'Colorful modern abstract painting with bold geometric shapes',
    shape: 'landscape',
  },
  {
    id: 'garden-study',
    title: 'Garden Study No. 4',
    category: 'Drawing',
    year: '2024',
    medium: 'Gouache and graphite on paper',
    image: 'https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?auto=format&fit=crop&w=1200&q=85',
    alt: 'Layered abstract artwork with vivid green and yellow brushwork',
    shape: 'square',
  },
  {
    id: 'slow-sunday',
    title: 'A Slow Sunday',
    category: 'Painting',
    year: '2024',
    medium: 'Acrylic on canvas',
    image: 'https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?auto=format&fit=crop&w=1200&q=85',
    alt: 'Warm-toned abstract painting with gestural marks',
    shape: 'portrait',
  },
];

app.get('/api/artworks', (_request, response) => {
  response.json(artworks);
});

app.use(express.static(path.join(projectDirectory, 'dist')));
app.get('/{*path}', (_request, response) => {
  response.sendFile(path.join(projectDirectory, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`ProjextArt server listening on http://localhost:${port}`);
});