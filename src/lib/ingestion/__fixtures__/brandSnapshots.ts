const nikeTopsTable = `
<section>
  <h2>Men's Tops & Tees</h2>
  <table>
    <tr><th>Measure</th><th>XXS</th><th>XS</th><th>S Tall</th><th>M</th><th>M Tall</th><th>3XL</th><th>4XL</th></tr>
    <tr><th>Chest (cm)</th><td>76-81</td><td>82-88</td><td>89-96</td><td>97-104</td><td>97-104</td><td>124-136</td><td>136-148</td></tr>
    <tr><th>Waist (cm)</th><td>61-66</td><td>67-73</td><td>74-81</td><td>82-89</td><td>82-89</td><td>112-124</td><td>124-136</td></tr>
    <tr><th>Hips (cm)</th><td>80-85</td><td>86-91</td><td>92-99</td><td>100-107</td><td>100-107</td><td>124-136</td><td>136-148</td></tr>
  </table>
</section>`;

const adidasTopTable = `
<section>
  <h2>Men's Shirts & Tops</h2>
  <p>International apparel sizes in cm.</p>
  <table>
    <tr><th>Measure</th><th>XXS</th><th>XS</th><th>S</th><th>M</th><th>L</th><th>XL</th><th>XXL</th><th>3XL</th><th>4XL</th></tr>
    <tr><th>Chest (cm)</th><td>79-83</td><td>84-89</td><td>90-95</td><td>96-103</td><td>104-111</td><td>112-119</td><td>120-127</td><td>128-135</td><td>136-143</td></tr>
    <tr><th>Waist (cm)</th><td>67-71</td><td>72-77</td><td>78-83</td><td>84-91</td><td>92-99</td><td>100-107</td><td>108-115</td><td>116-123</td><td>124-131</td></tr>
    <tr><th>Hips (cm)</th><td>82-86</td><td>87-92</td><td>93-98</td><td>99-106</td><td>107-114</td><td>115-122</td><td>123-130</td><td>131-138</td><td>139-146</td></tr>
  </table>
</section>`;

const adidasBottomsTable = `
<section>
  <h2>Men's Bottoms</h2>
  <table>
    <tr><th>Size</th><th>Waist (cm)</th><th>Inseam (cm)</th></tr>
    <tr><td>S</td><td>78-83</td><td>80-81</td></tr>
    <tr><td>M</td><td>84-91</td><td>81-82</td></tr>
    <tr><td>L</td><td>92-99</td><td>82-83</td></tr>
  </table>
</section>`;

const reebokTopTable = `
<section>
  <h2>Men's Tops Size Guide</h2>
  <table>
    <tr><th>Size</th><th>Chest (cm)</th><th>Waist (cm)</th><th>Hips (cm)</th></tr>
    <tr><td>M</td><td>96-102</td><td>81-87</td><td>96-102</td></tr>
    <tr><td>L</td><td>103-109</td><td>88-94</td><td>103-109</td></tr>
    <tr><td>XL</td><td>110-116</td><td>95-101</td><td>110-116</td></tr>
    <tr><td>2XL</td><td>117-123</td><td>102-108</td><td>117-123</td></tr>
    <tr><td>3XL</td><td>124-130</td><td>109-115</td><td>124-130</td></tr>
    <tr><td>4XL</td><td>131-137</td><td>116-122</td><td>131-137</td></tr>
    <tr><td>5XL</td><td>138-144</td><td>123-129</td><td>138-144</td></tr>
  </table>
</section>`;

const shoeTable = `
<section>
  <h2>Footwear Size Guide</h2>
  <table>
    <tr><th>US</th><th>Foot Length (cm)</th></tr>
    <tr><td>8</td><td>26</td></tr>
    <tr><td>9</td><td>27</td></tr>
  </table>
</section>`;

export const fixtures = {
  nikeDirect: {
    url: "https://www.nike.com/size-fit-guide",
    html: `<!doctype html><html><body>${nikeTopsTable}</body></html>`,
    markdown: `
## Men's Tops & Tees
| Measure | XXS | XS | S Tall | M | M Tall | 3XL | 4XL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chest (cm) | 76-81 | 82-88 | 89-96 | 97-104 | 97-104 | 124-136 | 136-148 |
| Waist (cm) | 61-66 | 67-73 | 74-81 | 82-89 | 82-89 | 112-124 | 124-136 |
| Hips (cm) | 80-85 | 86-91 | 92-99 | 100-107 | 100-107 | 124-136 | 136-148 |
`,
  },
  nikeHubWithProductLink: {
    url: "https://www.nike.com/size-fit-guide",
    html: `<!doctype html><html><body>
      <h1>Size & Fit Guide</h1>
      <a href="/#main">Skip to main content</a>
      <a href="/gb/w/mens-graphic-tees">Tops & Graphic Tees</a>
      <a href="/t/dri-fit-legend-mens-fitness-t-shirt-abc123">Nike Dri-FIT Legend Men's Fitness T-Shirt $35</a>
      <a href="/gb/size-fit/mens-shoes">Men's Shoes Size Guide</a>
    </body></html>`,
    markdown: `
# Size & Fit Guide
[Skip to main content](/#main)
[Tops & Graphic Tees](/gb/w/mens-graphic-tees)
[Nike Dri-FIT Legend Men's Fitness T-Shirt $35](/t/dri-fit-legend-mens-fitness-t-shirt-abc123)
[Men's Shoes Size Guide](/gb/size-fit/mens-shoes)
`,
    followed: {
      "https://www.nike.com/gb/w/mens-graphic-tees": {
        sourceUrl: "https://www.nike.com/gb/w/mens-graphic-tees",
        html: `<!doctype html><html><body>
          <h1>Men's Graphic Tees</h1>
          <a href="/size-fit/mens_tops_alpha">Men's Tops Size Chart</a>
          <a href="/t/dri-fit-legend-mens-fitness-t-shirt-abc123">Nike Dri-FIT Legend Men's Fitness T-Shirt $35</a>
        </body></html>`,
        markdown: `
# Men's Graphic Tees
[Men's Tops Size Chart](/size-fit/mens_tops_alpha)
[Nike Dri-FIT Legend Men's Fitness T-Shirt $35](/t/dri-fit-legend-mens-fitness-t-shirt-abc123)
`,
      },
      "https://www.nike.com/size-fit/mens_tops_alpha": {
        sourceUrl: "https://www.nike.com/size-fit/mens_tops_alpha",
        html: `<!doctype html><html><body>${nikeTopsTable}</body></html>`,
        markdown: `
## Men's Tops & Tees
| Measure | XXS | XS | S Tall | M | M Tall | 3XL | 4XL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chest (cm) | 76-81 | 82-88 | 89-96 | 97-104 | 97-104 | 124-136 | 136-148 |
| Waist (cm) | 61-66 | 67-73 | 74-81 | 82-89 | 82-89 | 112-124 | 124-136 |
| Hips (cm) | 80-85 | 86-91 | 92-99 | 100-107 | 100-107 | 124-136 | 136-148 |
`,
      },
      "https://www.nike.com/gb/size-fit/mens-tops-alpha": {
        sourceUrl: "https://www.nike.com/gb/size-fit/mens-tops-alpha",
        html: `<!doctype html><html><body>${nikeTopsTable}</body></html>`,
        markdown: `
## Men's Tops & Tees
| Measure | XXS | XS | S Tall | M | M Tall | 3XL | 4XL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chest (cm) | 76-81 | 82-88 | 89-96 | 97-104 | 97-104 | 124-136 | 136-148 |
| Waist (cm) | 61-66 | 67-73 | 74-81 | 82-89 | 82-89 | 112-124 | 124-136 |
| Hips (cm) | 80-85 | 86-91 | 92-99 | 100-107 | 100-107 | 124-136 | 136-148 |
`,
      },
      "https://www.nike.com/gb/size-fit/mens-shoes": {
        sourceUrl: "https://www.nike.com/gb/size-fit/mens-shoes",
        html: `<!doctype html><html><body>${shoeTable}</body></html>`,
        markdown: `
## Footwear Size Guide
| US | Foot Length (cm) |
| --- | --- |
| 8 | 26 |
| 9 | 27 |
`,
      },
    },
  },
  adidasMulti: {
    url: "https://www.adidas.com/size-chart",
    html: `<!doctype html><html><body>${adidasTopTable}${adidasBottomsTable}</body></html>`,
    markdown: `
## Men's Shirts & Tops
| Measure | XXS | XS | S | M | L | XL | XXL | 3XL | 4XL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chest (cm) | 79-83 | 84-89 | 90-95 | 96-103 | 104-111 | 112-119 | 120-127 | 128-135 | 136-143 |
| Waist (cm) | 67-71 | 72-77 | 78-83 | 84-91 | 92-99 | 100-107 | 108-115 | 116-123 | 124-131 |
| Hips (cm) | 82-86 | 87-92 | 93-98 | 99-106 | 107-114 | 115-122 | 123-130 | 131-138 | 139-146 |

## Men's Bottoms
| Size | Waist (cm) | Inseam (cm) |
| --- | --- | --- |
| S | 78-83 | 80-81 |
| M | 84-91 | 81-82 |
| L | 92-99 | 82-83 |
`,
  },
  adidasHub: {
    url: "https://www.adidas.com/size-chart",
    html: `<!doctype html><html><body>
      <h1>Size Chart</h1>
      <a href="/size-chart/men-tops">Men's Tops Size Guide</a>
      <a href="/size-chart/men-bottoms">Men's Pants Size Guide</a>
      <a href="/size-chart/men-shoes">Men's Shoes Size Guide</a>
    </body></html>`,
    markdown: `
# Size Chart
[Men's Tops Size Guide](/size-chart/men-tops)
[Men's Pants Size Guide](/size-chart/men-bottoms)
[Men's Shoes Size Guide](/size-chart/men-shoes)
`,
    followed: {
      "https://www.adidas.com/size-chart/men-tops": {
        sourceUrl: "https://www.adidas.com/size-chart/men-tops",
        html: `<!doctype html><html><body>${adidasTopTable}</body></html>`,
        markdown: `
## Men's Shirts & Tops
| Measure | XXS | XS | S | M | L | XL | XXL | 3XL | 4XL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chest (cm) | 79-83 | 84-89 | 90-95 | 96-103 | 104-111 | 112-119 | 120-127 | 128-135 | 136-143 |
| Waist (cm) | 67-71 | 72-77 | 78-83 | 84-91 | 92-99 | 100-107 | 108-115 | 116-123 | 124-131 |
| Hips (cm) | 82-86 | 87-92 | 93-98 | 99-106 | 107-114 | 115-122 | 123-130 | 131-138 | 139-146 |
`,
      },
      "https://www.adidas.com/size-chart/men-bottoms": {
        sourceUrl: "https://www.adidas.com/size-chart/men-bottoms",
        html: `<!doctype html><html><body>${adidasBottomsTable}</body></html>`,
        markdown: `
## Men's Bottoms
| Size | Waist (cm) | Inseam (cm) |
| --- | --- | --- |
| S | 78-83 | 80-81 |
| M | 84-91 | 81-82 |
| L | 92-99 | 82-83 |
`,
      },
    },
  },
  reebokMulti: {
    url: "https://www.reebok.com/size-guides",
    html: `<!doctype html><html><body>${shoeTable}${reebokTopTable}</body></html>`,
    markdown: `
## Footwear Size Guide
| US | Foot Length (cm) |
| --- | --- |
| 8 | 26 |
| 9 | 27 |

## Men's Tops Size Guide
| Size | Chest (cm) | Waist (cm) | Hips (cm) |
| --- | --- | --- | --- |
| M | 96-102 | 81-87 | 96-102 |
| L | 103-109 | 88-94 | 103-109 |
| XL | 110-116 | 95-101 | 110-116 |
| 2XL | 117-123 | 102-108 | 117-123 |
| 3XL | 124-130 | 109-115 | 124-130 |
| 4XL | 131-137 | 116-122 | 131-137 |
| 5XL | 138-144 | 123-129 | 138-144 |
`,
  },
  reebokHub: {
    url: "https://www.reebok.com/size-chart",
    html: `<!doctype html><html><body>
      <h1>Size Chart</h1>
      <a href="/size-chart/mens-shoes">Men's Shoes Size Guide</a>
      <a href="/size-chart/mens-tops">Men's Tops Size Guide</a>
    </body></html>`,
    markdown: `
# Size Chart
[Men's Shoes Size Guide](/size-chart/mens-shoes)
[Men's Tops Size Guide](/size-chart/mens-tops)
`,
    followed: {
      "https://www.reebok.com/size-chart/mens-tops": {
        sourceUrl: "https://www.reebok.com/size-chart/mens-tops",
        html: `<!doctype html><html><body>${reebokTopTable}</body></html>`,
        markdown: `
## Men's Tops Size Guide
| Size | Chest (cm) | Waist (cm) | Hips (cm) |
| --- | --- | --- | --- |
| M | 96-102 | 81-87 | 96-102 |
| L | 103-109 | 88-94 | 103-109 |
| XL | 110-116 | 95-101 | 110-116 |
| 2XL | 117-123 | 102-108 | 117-123 |
| 3XL | 124-130 | 109-115 | 124-130 |
| 4XL | 131-137 | 116-122 | 131-137 |
| 5XL | 138-144 | 123-129 | 138-144 |
`,
      },
      "https://www.reebok.com/size-chart/mens-shoes": {
        sourceUrl: "https://www.reebok.com/size-chart/mens-shoes",
        html: `<!doctype html><html><body>${shoeTable}</body></html>`,
        markdown: `
## Footwear Size Guide
| US | Foot Length (cm) |
| --- | --- |
| 8 | 26 |
| 9 | 27 |
`,
      },
    },
  },
  underArmourHub: {
    url: "https://www.underarmour.com/en-us/t/size-guide/",
    html: `<!doctype html><html><body>
      <h1>Size Guide</h1>
      <p>Select a category.</p>
      <a href="/en-us/t/size-guide/mens-tops/">Men's Tops Size Guide</a>
      <a href="/en-us/t/size-guide/mens-shoes/">Men's Shoes Size Guide</a>
    </body></html>`,
    markdown: `
# Size Guide
[Men's Tops Size Guide](/en-us/t/size-guide/mens-tops/)
[Men's Shoes Size Guide](/en-us/t/size-guide/mens-shoes/)
`,
    followed: {
      "https://www.underarmour.com/en-us/t/size-guide/mens-tops/": {
        sourceUrl: "https://www.underarmour.com/en-us/t/size-guide/mens-tops/",
        html: `<!doctype html><html><body>${reebokTopTable}</body></html>`,
        markdown: `
## Men's Tops Size Guide
| Size | Chest (cm) | Waist (cm) | Hips (cm) |
| --- | --- | --- | --- |
| M | 96-102 | 81-87 | 96-102 |
| L | 103-109 | 88-94 | 103-109 |
| XL | 110-116 | 95-101 | 110-116 |
| 2XL | 117-123 | 102-108 | 117-123 |
| 3XL | 124-130 | 109-115 | 124-130 |
| 4XL | 131-137 | 116-122 | 131-137 |
| 5XL | 138-144 | 123-129 | 138-144 |
`,
      },
      "https://www.underarmour.com/en-us/t/size-guide/mens-shoes/": {
        sourceUrl: "https://www.underarmour.com/en-us/t/size-guide/mens-shoes/",
        html: `<!doctype html><html><body>${shoeTable}</body></html>`,
        markdown: `
## Footwear Size Guide
| US | Foot Length (cm) |
| --- | --- |
| 8 | 26 |
| 9 | 27 |
`,
      },
    },
  },
  newBalanceHub: {
    url: "https://www.newbalance.com/size-guide/",
    html: `<!doctype html><html><body>
      <h1>Size Guide</h1>
      <a href="/size-guide/footwear/">Footwear Size Guide</a>
      <a href="/size-guide/apparel/">Apparel Size Guide</a>
    </body></html>`,
    markdown: `
# Size Guide
[Footwear Size Guide](/size-guide/footwear/)
[Apparel Size Guide](/size-guide/apparel/)
`,
    followed: {
      "https://www.newbalance.com/size-guide/apparel/": {
        sourceUrl: "https://www.newbalance.com/size-guide/apparel/",
        html: `<!doctype html><html><body>${nikeTopsTable}</body></html>`,
        markdown: `
## Men's Tops & Tees
| Measure | XXS | XS | S Tall | M | M Tall | 3XL | 4XL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chest (cm) | 76-81 | 82-88 | 89-96 | 97-104 | 97-104 | 124-136 | 136-148 |
| Waist (cm) | 61-66 | 67-73 | 74-81 | 82-89 | 82-89 | 112-124 | 124-136 |
| Hips (cm) | 80-85 | 86-91 | 92-99 | 100-107 | 100-107 | 124-136 | 136-148 |
`,
      },
    },
  },
  pumaFootwearOnly: {
    url: "https://eu.puma.com/size-guide",
    html: `<!doctype html><html><body>${shoeTable}</body></html>`,
    markdown: `
## Footwear Size Guide
| US | Foot Length (cm) |
| --- | --- |
| 8 | 26 |
| 9 | 27 |
`,
  },
  invalidTopWithInseam: {
    url: "https://example.com/tshirts",
    html: `<!doctype html><html><body>
      <section>
        <h2>Men's T-Shirts</h2>
        <table>
          <tr><th>Size</th><th>Chest (cm)</th><th>Inseam (cm)</th></tr>
          <tr><td>S</td><td>90-95</td><td>78-80</td></tr>
          <tr><td>M</td><td>96-103</td><td>80-82</td></tr>
          <tr><td>L</td><td>104-111</td><td>82-84</td></tr>
        </table>
      </section>
    </body></html>`,
    markdown: `
## Men's T-Shirts
| Size | Chest (cm) | Inseam (cm) |
| --- | --- | --- |
| S | 90-95 | 78-80 |
| M | 96-103 | 80-82 |
| L | 104-111 | 82-84 |
`,
  },
  invalidBottomWithChest: {
    url: "https://example.com/pants",
    html: `<!doctype html><html><body>
      <section>
        <h2>Men's Pants</h2>
        <table>
          <tr><th>Size</th><th>Waist (cm)</th><th>Chest (cm)</th></tr>
          <tr><td>S</td><td>78-83</td><td>90-95</td></tr>
          <tr><td>M</td><td>84-91</td><td>96-103</td></tr>
          <tr><td>L</td><td>92-99</td><td>104-111</td></tr>
        </table>
      </section>
    </body></html>`,
    markdown: `
## Men's Pants
| Size | Waist (cm) | Chest (cm) |
| --- | --- | --- |
| S | 78-83 | 90-95 |
| M | 84-91 | 96-103 |
| L | 92-99 | 104-111 |
`,
  },
  mixedBodyGuide: {
    url: "https://example.com/size-guide",
    html: `<!doctype html><html><body>
      <section>
        <h2>Body Measurements</h2>
        <table>
          <tr><th>Size</th><th>Chest (cm)</th><th>Inseam (cm)</th></tr>
          <tr><td>S</td><td>90-95</td><td>78-80</td></tr>
          <tr><td>M</td><td>96-103</td><td>80-82</td></tr>
        </table>
      </section>
    </body></html>`,
    markdown: `
## Body Measurements
| Size | Chest (cm) | Inseam (cm) |
| --- | --- | --- |
| S | 90-95 | 78-80 |
| M | 96-103 | 80-82 |
`,
  },
  breadthLoss: {
    url: "https://example.com/tops",
    html: `<!doctype html><html><body>
      <section>
        <h2>Men's Tops</h2>
        <table>
          <tr><th>Size</th><th>Chest (cm)</th></tr>
          <tr><td>XXS</td><td></td></tr>
          <tr><td>XS</td><td></td></tr>
          <tr><td>S</td><td>90-95</td></tr>
          <tr><td>M</td><td>96-103</td></tr>
        </table>
      </section>
    </body></html>`,
    markdown: `
## Men's Tops
| Size | Chest (cm) |
| --- | --- |
| XXS |  |
| XS |  |
| S | 90-95 |
| M | 96-103 |
`,
  },
  advisoryOnly: {
    url: "https://example.com/guide",
    html: `<!doctype html><html><body>
      <h2>Size Guide</h2>
      <p>Use a tape measure around the fullest part of your chest and compare to the chart above.</p>
    </body></html>`,
    markdown: `
## Size Guide
Use a tape measure around the fullest part of your chest and compare to the chart above.
`,
  },
} as const;
