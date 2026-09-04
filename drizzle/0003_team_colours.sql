-- Repaints the teams of leagues created before document 7 §3 replaced the
-- palette of document 2 §4.3. The two lists share no value, so a team saved
-- earlier carries a hex the picker no longer offers: it would stop showing that
-- team's colour as one of the ten, and `labelOf` would fall back to announcing
-- the raw hex inside the button's accessible name.
--
-- Position by position, because the order is the system: §3 assigns the six
-- verified hues first and the four additions after, so the first team of a
-- league keeps being the first colour of the palette.
--
-- One statement and not ten, for two reasons. It is order-independent, so it
-- cannot depend on the two lists happening to be disjoint today; and `color` is
-- outside the snapshot (`snapshotTeam` serialises four fields and this is not
-- one of them), so no fingerprint of a crystallised league moves — which is the
-- only thing that made repainting a played league safe to do at all.
--
-- `upper(color)` on both sides: the column is free text with no CHECK, and the
-- values already written are uppercase while nothing guarantees the next ones
-- will be.
UPDATE `fanta_team`
SET `color` = CASE upper(`color`)
  WHEN '#F2564D' THEN '#E89A3C'  -- corallo   -> arancio
  WHEN '#E8703A' THEN '#6FC3EC'  -- ruggine   -> celeste
  WHEN '#C3D63F' THEN '#3FAE83'  -- lime      -> verde
  WHEN '#5FC46B' THEN '#7E9DE8'  -- prato     -> blu
  WHEN '#2FBF91' THEN '#E8735A'  -- smeraldo  -> vermiglio
  WHEN '#35B5D6' THEN '#D48FB5'  -- ciano     -> rosa
  WHEN '#4A8CF0' THEN '#A9C34A'  -- azzurro   -> lime
  WHEN '#8B7BF0' THEN '#B78FE0'  -- indaco    -> violetto
  WHEN '#C46BE8' THEN '#C79B6B'  -- viola     -> terra
  WHEN '#EE5FA7' THEN '#C67DBD'  -- magenta   -> orchidea
END
WHERE upper(`color`) IN (
  '#F2564D', '#E8703A', '#C3D63F', '#5FC46B', '#2FBF91',
  '#35B5D6', '#4A8CF0', '#8B7BF0', '#C46BE8', '#EE5FA7'
);
