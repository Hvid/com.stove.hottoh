/* global Homey, $ */
Homey.ready(function () {
  $('#title').text(Homey.__('pair.manual.title'));
  $('#desc').text(Homey.__('pair.manual.desc'));
  $('#ip_label').text(Homey.__('pair.manual.ip_label'));
  $('#port_label').text(Homey.__('pair.manual.port_label'));
  $('#submit').text(Homey.__('pair.manual.submit'));

  $('#submit').on('click', function () {
    const ip = $('#ip').val();
    const port = $('#port').val();
    if (!ip || !port) {
      Homey.alert(Homey.__('pair.manual.error_missing'));
      return;
    }
    // Send data to backend for validation and device creation
    Homey.emit('manual_entered', { ip, port }, function (err, result) {
      if (err) {
        Homey.alert(Homey.__('pair.manual.error_connect'));
        return;
      }
      // Optionally show success or move to next step
      Homey.nextView();
    });
  });
});
