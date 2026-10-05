// Recorded-shape TMDB v3 answers with fictional titles.
const NORTH_WIND = {
  id: 101, title: 'Северный ветер', original_title: 'North Wind', release_date: '2026-09-12', poster_path: '/nw.jpg',
  backdrop_path: '/nwb.jpg', vote_average: 7.4, vote_count: 312, adult: false, genre_ids: [18], original_language: 'en', overview: 'История о береговой охране.',
};
const ORBIT = {
  id: 202, name: 'Орбитальная станция', original_name: 'Orbit Station', first_air_date: '2024-03-01', poster_path: '/os.jpg',
  backdrop_path: '/osb.jpg', vote_average: 8.1, vote_count: 540, genre_ids: [10765], original_language: 'en', overview: 'Экипаж станции на дальней орбите.',
};

export const MOVIE_LIST = { page: 1, total_pages: 3, total_results: 52, results: [NORTH_WIND] };
export const TV_LIST = { page: 1, total_pages: 2, total_results: 31, results: [ORBIT] };
export const MULTI = {
  page: 1, total_pages: 1, total_results: 3,
  results: [
    { ...NORTH_WIND, media_type: 'movie' },
    { id: 303, name: 'Иван Северов', original_name: 'Ivan Severov', profile_path: '/p.jpg', media_type: 'person', known_for: [] },
    { ...ORBIT, media_type: 'tv' },
  ],
};

export const MOVIE_CARD = {
  ...NORTH_WIND, genres: [{ id: 18, name: 'драма' }], runtime: 112,
  credits: { cast: [{ name: 'Анна Вестова', character: 'Мария', profile_path: '/a.jpg' }, { name: 'Пётр Лесной', character: 'Капитан', profile_path: null }] },
};

export const TV_CARD = {
  ...ORBIT, genres: [{ id: 10765, name: 'фантастика' }], episode_run_time: [48], in_production: true,
  seasons: [
    { season_number: 0, name: 'Спецвыпуски', episode_count: 3, air_date: '2024-02-01' },
    { season_number: 1, name: 'Сезон 1', episode_count: 8, air_date: '2024-03-01' },
    { season_number: 2, name: 'Сезон 2', episode_count: 10, air_date: '2026-08-01' },
  ],
  last_episode_to_air: { season_number: 2, episode_number: 6 },
  next_episode_to_air: { season_number: 2, episode_number: 7, air_date: '2026-10-12' },
  credits: { cast: Array.from({ length: 12 }, (_, i) => ({ name: 'Актёр ' + (i + 1), character: 'Роль ' + (i + 1), profile_path: '/c' + i + '.jpg' })) },
};
