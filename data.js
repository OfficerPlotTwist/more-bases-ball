/* moreBasesBall — team data
 * Real 2024 MLB season batting lines (PA, H, 2B, 3B, HR, BB, SO).
 * Values are the players' actual 2024 regular-season statistics
 * (rounded/approximated to published season totals).
 */
(function (global) {
  'use strict';

  // p = [name, pos, PA, H, 2B, 3B, HR, BB, SO]
  function P(a) {
    return {
      name: a[0], pos: a[1], pa: a[2], h: a[3],
      d2: a[4], d3: a[5], hr: a[6], bb: a[7], so: a[8],
    };
  }

  const TEAMS = [
    {
      id: 'LAD', name: 'Los Angeles Dodgers', abbr: 'LAD', color: '#4A90D9',
      lineup: [
        P(['Shohei Ohtani', 'DH', 731, 197, 38, 7, 54, 81, 162]),
        P(['Mookie Betts', 'RF', 541, 140, 22, 1, 19, 63, 55]),
        P(['Freddie Freeman', '1B', 638, 163, 35, 2, 22, 76, 107]),
        P(['Teoscar Hernandez', 'LF', 652, 160, 33, 2, 33, 49, 161]),
        P(['Will Smith', 'C', 545, 118, 25, 1, 20, 58, 98]),
        P(['Max Muncy', '3B', 305, 59, 12, 0, 15, 41, 85]),
        P(['Gavin Lux', '2B', 487, 110, 22, 3, 10, 41, 100]),
        P(['Andy Pages', 'CF', 402, 89, 17, 2, 13, 26, 100]),
        P(['Tommy Edman', 'SS', 153, 34, 7, 1, 6, 6, 25]),
      ],
    },
    {
      id: 'NYY', name: 'New York Yankees', abbr: 'NYY', color: '#7A8CA8',
      lineup: [
        P(['Gleyber Torres', '2B', 665, 154, 26, 1, 15, 65, 115]),
        P(['Juan Soto', 'RF', 713, 166, 31, 4, 41, 129, 119]),
        P(['Aaron Judge', 'CF', 704, 180, 36, 1, 58, 133, 170]),
        P(['Austin Wells', 'C', 419, 87, 18, 1, 13, 44, 107]),
        P(['Giancarlo Stanton', 'DH', 459, 96, 13, 0, 27, 39, 137]),
        P(['Jazz Chisholm Jr.', '3B', 621, 147, 26, 5, 24, 45, 137]),
        P(['Anthony Volpe', 'SS', 693, 152, 27, 5, 12, 58, 153]),
        P(['Alex Verdugo', 'LF', 667, 142, 26, 1, 13, 51, 91]),
        P(['Anthony Rizzo', '1B', 375, 78, 11, 1, 8, 27, 60]),
      ],
    },
    {
      id: 'PHI', name: 'Philadelphia Phillies', abbr: 'PHI', color: '#D64541',
      lineup: [
        P(['Kyle Schwarber', 'DH', 692, 142, 23, 0, 38, 102, 197]),
        P(['Trea Turner', 'SS', 539, 149, 25, 4, 21, 37, 100]),
        P(['Bryce Harper', '1B', 631, 157, 42, 0, 30, 74, 128]),
        P(['Alec Bohm', '3B', 619, 155, 44, 2, 15, 45, 84]),
        P(['Nick Castellanos', 'RF', 659, 154, 32, 2, 23, 41, 162]),
        P(['J.T. Realmuto', 'C', 435, 101, 18, 1, 14, 30, 96]),
        P(['Bryson Stott', '2B', 636, 138, 23, 3, 11, 56, 90]),
        P(['Brandon Marsh', 'LF', 479, 104, 21, 3, 16, 50, 145]),
        P(['Edmundo Sosa', 'UT', 292, 68, 14, 3, 7, 17, 55]),
      ],
    },
    {
      id: 'ATL', name: 'Atlanta Braves', abbr: 'ATL', color: '#C06B3E',
      lineup: [
        P(['Marcell Ozuna', 'DH', 683, 183, 26, 0, 39, 74, 140]),
        P(['Austin Riley', '3B', 471, 109, 24, 1, 19, 38, 120]),
        P(['Matt Olson', '1B', 685, 148, 31, 0, 29, 74, 158]),
        P(['Ozzie Albies', '2B', 421, 96, 19, 2, 10, 27, 55]),
        P(['Michael Harris II', 'CF', 604, 148, 28, 3, 16, 27, 112]),
        P(['Orlando Arcia', 'SS', 602, 121, 26, 1, 17, 32, 123]),
        P(['Travis d\'Arnaud', 'C', 341, 74, 11, 0, 15, 21, 79]),
        P(['Jarred Kelenic', 'LF', 486, 101, 21, 2, 15, 34, 150]),
        P(['Ramon Laureano', 'RF', 269, 66, 13, 1, 9, 16, 68]),
      ],
    },
    {
      id: 'HOU', name: 'Houston Astros', abbr: 'HOU', color: '#E8883A',
      lineup: [
        P(['Jose Altuve', '2B', 682, 179, 25, 1, 20, 42, 116]),
        P(['Yordan Alvarez', 'DH', 635, 170, 34, 2, 35, 69, 118]),
        P(['Kyle Tucker', 'RF', 339, 79, 12, 1, 23, 56, 44]),
        P(['Alex Bregman', '3B', 634, 149, 30, 1, 26, 44, 68]),
        P(['Jeremy Pena', 'SS', 668, 165, 26, 3, 15, 33, 105]),
        P(['Yainer Diaz', 'C', 621, 172, 25, 0, 16, 24, 84]),
        P(['Jon Singleton', '1B', 405, 84, 14, 0, 13, 47, 100]),
        P(['Jake Meyers', 'CF', 461, 96, 21, 2, 9, 26, 98]),
        P(['Mauricio Dubon', 'UT', 457, 116, 22, 2, 5, 17, 61]),
      ],
    },
    {
      id: 'NYM', name: 'New York Mets', abbr: 'NYM', color: '#5B7FD4',
      lineup: [
        P(['Francisco Lindor', 'SS', 689, 170, 33, 2, 33, 57, 127]),
        P(['Brandon Nimmo', 'LF', 665, 132, 25, 1, 23, 76, 156]),
        P(['Pete Alonso', '1B', 695, 148, 31, 1, 34, 70, 172]),
        P(['Mark Vientos', '3B', 454, 110, 22, 0, 27, 34, 137]),
        P(['Starling Marte', 'RF', 555, 138, 21, 2, 16, 38, 117]),
        P(['Jeff McNeil', '2B', 472, 102, 21, 1, 12, 38, 61]),
        P(['Francisco Alvarez', 'C', 418, 87, 17, 1, 11, 33, 108]),
        P(['Jose Iglesias', 'UT', 291, 90, 12, 1, 4, 13, 40]),
        P(['Tyrone Taylor', 'CF', 361, 79, 14, 2, 7, 21, 97]),
      ],
    },
  ];

  const API = { TEAMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.MBB_DATA = API;
})(typeof window !== 'undefined' ? window : globalThis);
