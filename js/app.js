var __ = window.__ = require('underscore'),
    Backbone = require('backbone'),
    $ = require('jquery');
Backbone.$ = $;
//add to global scope for non-modular libraries
window.Backbone = Backbone;
window.$ = $;
window.jQuery = $;
window.Backbone.$ = $;
window.focused = true;

// we need to know this for notifications
window.onfocus = function() {
  window.focused = true;
};

window.onblur = function() {
  window.focused = false;
};

var Polyglot = require('node-polyglot'),
    getBTPrice = require('./utils/getBitcoinPrice'),
    isLocalServerRunning = require('./utils/isLocalServerRunning'),
    isRemoteServerRunning = require('./utils/isRemoteServerRunning'),
    router = require('./router'),
    userModel = require('./models/userMd'),
    userProfileModel = require('./models/userProfileMd'),
    languagesModel = require('./models/languagesMd'),
    ServerConfigMd = require('./models/serverConfigMd'),
    mouseWheel = require('jquery-mousewheel'),
    mCustomScrollbar = require('./utils/jquery.mCustomScrollbar.js'),
    setTheme = require('./utils/setTheme.js'),
    pageNavView = require('./views/pageNavVw'),
    chatAppView = require('./views/chatAppVw'),
    user = new userModel(),
    userProfile = new userProfileModel(),
    languages = new languagesModel(),
    socketView = require('./views/socketVw'),
    cCode = "",
    $loadingModal = $('.js-loadingModal'),
    ServerConnectModal = require('./views/serverConnectModal'),
    OnboardingModal = require('./views/onboardingModal'),
    serverConfigMd,
    newRouter,
    newPageNavView,
    newSocketView,
    newChatAppView,
    serverConnectModal,
    onboardingModal,
    startInitSequence,
    startLocalInitSequence,
    startRemoteInitSequence,
    launchOnboarding,
    launchServerConnect,
    setServerUrl;


// TODO: what is wrong with the localStorage adapter??? shouldn't need
// to manually provide the data to the model. All that should be needed
// is an ID and then a subsequent fetch, but that doesn't return the data.
// Investigate!
serverConfigMd = new ServerConfigMd( JSON.parse(localStorage['_serverConfig-1']) );
// serverConfigMd.fetch();

(setServerUrl = function() {
  var baseServerUrl = serverConfigMd.getServerBaseUrl();
  
  user.urlRoot = baseServerUrl + "/settings";
  user.set('serverUrl', baseServerUrl + '/');
  userProfile.urlRoot = baseServerUrl + "/profile";
})();

serverConfigMd.on('sync', function(md) {
  setServerUrl();
  startInitSequence();
});

// $.ajax({
//   beforeSend: function() { jqxhr.requestURL = "http://some/url"; },
// });

//put language in the window so all templates and models can reach it. It's especially important in formatting currency.
window.lang = user.get("language");

//put polyglot in the window so all templates can reach it
window.polyglot = new Polyglot({locale: window.lang});

//retrieve the object that has a matching language code
window.polyglot.extend(__.where(languages.get('languages'), {langCode: window.lang})[0]);

//put the event bus into the window so it's available everywhere
window.obEventBus =  __.extend({}, Backbone.Events);

// fix zoom issue on Linux hiDPI
var platform = process.platform;

if(platform === "linux") {
  var scaleFactor = require('screen').getPrimaryDisplay().scaleFactor;
  if (scaleFactor === 0) {
      scaleFactor = 1;
  }
  $("body").css("zoom", 1 / scaleFactor);
}

//open external links in a browser, not the app
$('body').on('click', '.js-externalLink', function(e){
  e.preventDefault();
  var extUrl = $(this).attr('href');
  if (!/^https?:\/\//i.test(extUrl)) {
    extUrl = 'http://' + extUrl;
  }
  require("shell").openExternal(extUrl);
});

//record changes to the app state
$(window).bind('hashchange', function(){
  "use strict";
  localStorage.setItem('route', Backbone.history.getFragment());
});

//prevent dragging a file to the window from loading that file
window.addEventListener("dragover",function(e){
  e = e || event;
  e.preventDefault();
},false);
window.addEventListener("drop",function(e){
  e = e || event;
  e.preventDefault();
},false);

var setCurrentBitCoin = function(cCode, userModel, callback) {
  "use strict";
  getBTPrice(cCode, function (btAve, currencyList) {
    //put the current bitcoin price in the window so it doesn't have to be passed to models
    if (!btAve){
      currencyList = currencyList.join("\n");
      alert("Bitcoin prices for your selected currency are not available. Your currency has been set to BTC. " +
          "You can change this in the settings console. \n\n The following currencies are available: \n\n" + currencyList);
      window.currentBitcoin = 1;
      userModel.set('currency_code', 'BTC');
    }
    window.currentBitcoin = btAve;
    typeof callback === 'function' && callback();
  });
};

var loadProfile = function(landingRoute) {
  landingRoute = landingRoute || '#';

  //get the guid from the user profile to put in the user model
  userProfile.fetch({
    timeout: 4000,
    success: function (model, response) {
      "use strict";
      //make sure profile is not blank
      if (response.profile){
        setTheme(model.get('profile').primary_color, model.get('profile').secondary_color, model.get('profile').background_color, model.get('profile').text_color);
        //get the user
        user.fetch({
          success: function (model, response) {
            cCode = model.get('currency_code');

            //get user bitcoin price before loading pages
            setCurrentBitCoin(cCode, user, function() {
              $loadingModal.addClass('hide');
              
              newSocketView && newSocketView.remove();
              newPageNavView && newPageNavView.remove();
              newChatAppView && newChatAppView;

              newSocketView = new socketView({model: serverConfigMd});
              newPageNavView = new pageNavView({model: user, socketView: newSocketView, userProfile: userProfile});
              newChatAppView = new chatAppView({model: user, socketView: newSocketView});

              newRouter = new router({userModel: user, userProfile: userProfile, socketView: newSocketView, chatAppView: newChatAppView});
              location.hash = landingRoute;
              Backbone.history.start();
            });

            //every 15 minutes update the bitcoin price for the currently selected currency
            window.bitCoinPriceChecker = setInterval(function () {
              setCurrentBitCoin(model.get('currency_code'), user);
            }, 54000000);
          }
        });
      }
    }
  });
};

launchOnboarding = function(creatingGuid) {
  // For local servers, a creatingGuid promise is passed in.
  var options = {
    model: user,
    userProfile: userProfile,
    serverConfig: serverConfigMd
  };

  if (creatingGuid) options['guidCreationPromise'] = creatingGuid;
  onboardingModal && onboardingModal.remove();
  onboardingModal = new OnboardingModal(options);
  onboardingModal.render().open();

  if (creatingGuid) {
    creatingGuid.fail(function() {
      // guid creation failed
      // server probably went down during guid creation
      // todo: need to test this very edgy case
      onboardingModal && onboardingModal.remove()
      onboardingModal = null;
      startLocalInitSequence();
      console.log('guid creation failed');
    });
  }

  onboardingModal.on('onboarding-complete', function(guid) {
    console.log('onboarding is complete - hoo to the ray!');
    onboardingModal && onboardingModal.remove()
    onboardingModal = null;
    loadProfile('#userPage/' + guid + '/store');       
  });  
};

launchServerConnect = function() {
  serverConnectModal && serverConnectModal.remove();
  serverConnectModal = new ServerConnectModal({
    model: serverConfigMd
  });

  serverConnectModal.on('connect', function() {
    serverConnectModal.remove();
    startInitSequence();
    $loadingModal.removeClass('hide');
  });

  serverConnectModal.render().open();
  serverConfigMd.isLocalServer() && serverConnectModal.start();
};

startLocalInitSequence = function() {
  return isLocalServerRunning(
    serverConfigMd.getServerBaseUrl() + '/profile',
    serverConfigMd.getGuidCheckUrl(),
    {
      interval: 100, // 10 times a second
      maxAttempts: 1, // for 1 seconds    
    }
  ).done(function(creatingGuid, profileData) {
    console.log('server is running');

    // server is running
    if (creatingGuid) {
      console.log('guid creation in progress');
      // guid creation in progress
      launchOnboarding(creatingGuid);
    } else {
      // Guid had previously been generated.
      if (__.isEmpty(profileData)) {
        // onboarding complete
        loadProfile();

        // todo: examine and potentially refactor loadProfile().
        // todo: since we have the profile data here,
        // we could pass it into loadProfile and if we do so,
        // it could skip that particular fetch.
      } else {
        // onboarding needed
        launchOnboarding($.Deferred().resolve().promise());
      }
    }
  }).fail(function() {
    console.log('The server is most certainly NOT running.');

    // server is down
    launchServerConnect();
  });
};

startRemoteInitSequence = function() {
  return isRemoteServerRunning(serverConfigMd.getServerBaseUrl() + '/profile')
    .done(function(profileData) {
      console.log('remote server is running');
      
      // remote server is running
      if (__.isEmpty(profileData)) {
        // onboarding needed
        launchOnboarding();
      } else {
        // onboarding complete
        loadProfile();
      }
    }).fail(function() {
      console.log('The remote server is most certainly NOT running.');

      // remote server is down or guid is generating
      launchServerConnect();
    });
};

(startInitSequence = function() {
  if (serverConfigMd.isLocalServer()) {
    startLocalInitSequence();
  } else {
    startRemoteInitSequence();
  }
})();
