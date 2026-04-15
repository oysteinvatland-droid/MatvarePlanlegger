-- Legg til oda.no-URL på oppskrifter for direkte bestilling
ALTER TABLE recipes ADD COLUMN oda_url TEXT;
