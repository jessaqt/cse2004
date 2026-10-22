const tipsToggle = document.querySelector('.tip-card .button');
const tipsPanel = document.querySelector('#tips');

tipsToggle.addEventListener('click', function () {
  const isHidden = tipsPanel.hidden;
  tipsPanel.hidden = !isHidden;
  tipsToggle.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
  tipsToggle.textContent = isHidden ? 'Hide tips' : 'Here are some tips';
});

const preferenceForm = document.querySelector('#preference-form');
const formMessage = document.querySelector('#form-message');

preferenceForm.addEventListener('submit', function (event) {
  event.preventDefault();

  const sweetChecked = document.querySelector('#sweet').checked;
  const umamiChecked = document.querySelector('#umami').checked;
  const earthyChecked = document.querySelector('#earthy').checked;
  const creamyChecked = document.querySelector('#creamy').checked;
  const bitterChecked = document.querySelector('#bitter').checked;
  const unsureChecked = document.querySelector('#unsure').checked;

  if (
    !sweetChecked &&
    !umamiChecked &&
    !earthyChecked &&
    !creamyChecked &&
    !bitterChecked &&
    !unsureChecked
  ) {
    formMessage.textContent = 'Please select at least one flavor, or choose “Not sure yet.”';
    return;
  }

  let suggestion;
  if (creamyChecked) {
    suggestion = 'Try an iced matcha latte: whisk matcha with a little warm water until smooth, then pour it over milk and ice.';
  } else if (sweetChecked) {
    suggestion = 'Try a gently sweetened matcha latte: whisk matcha with warm water, add milk, and sweeten to taste.';
  } else if (umamiChecked || earthyChecked) {
    suggestion = 'Try matcha whisked with warm water, served straight so its savory, grassy notes can shine.';
  } else if (bitterChecked) {
    suggestion = 'Try a lighter cup: sift a smaller amount of matcha, whisk with warm (not boiling) water, and adjust to taste.';
  } else if (unsureChecked) {
    suggestion = 'Start with a classic cup: sift matcha, whisk it with a splash of warm water until smooth, then add more water to taste.';
  } else {
    suggestion = 'Try matcha whisked with warm water, served straight so its flavor can shine.';
  }

  formMessage.textContent = suggestion;
});