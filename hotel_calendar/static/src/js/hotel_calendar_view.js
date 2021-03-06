/* global $, odoo, _, HotelCalendar, moment */
odoo.define('hotel_calendar.HotelCalendarView', function (require) {
"use strict";
/*
 * Hotel Calendar View
 * GNU Public License
 * Aloxa Solucions S.L. <info@aloxa.eu>
 *     Alexandre Díaz <alex@aloxa.eu>
 */

var Core = require('web.core'),
    Bus = require('bus.bus').bus,
    //Data = require('web.data'),
    Time = require('web.time'),
    Model = require('web.DataModel'),
    View = require('web.View'),
    Common = require('web.form_common'),
    //Pyeval = require('web.pyeval'),
    ActionManager = require('web.ActionManager'),
    Utils = require('web.utils'),
    Dialog = require('web.Dialog'),
    Ajax = require('web.ajax'),
    ControlPanel = require('web.ControlPanel'),
    Session = require('web.session'),
    SystrayMenu = require('web.SystrayMenu'),
    Widget = require('web.Widget'),
    //Formats = require('web.formats'),

    _t = Core._t,
    _lt = Core._lt,
    QWeb = Core.qweb,
    l10n = _t.database.parameters,

    ODOO_DATE_MOMENT_FORMAT = 'YYYY-MM-DD',
    ODOO_DATETIME_MOMENT_FORMAT = ODOO_DATE_MOMENT_FORMAT + ' HH:mm:ss',
    L10N_DATE_MOMENT_FORMAT = "DD/MM/YYYY", //FIXME: Time.strftime_to_moment_format(l10n.date_format);
    L10N_DATETIME_MOMENT_FORMAT = L10N_DATE_MOMENT_FORMAT + ' ' + Time.strftime_to_moment_format(l10n.time_format),

    CURRENCY_SYMBOL = "€";

/* HIDE CONTROL PANEL */
/* FIXME: Look's like a hackish solution */
ControlPanel.include({
  update: function(status, options) {
      if (typeof options.toHide === 'undefined')
          options.toHide = false;
      var action_stack = this.getParent().action_stack;
      if (action_stack && action_stack.length) {
          var active_action = action_stack[action_stack.length-1];
          if (active_action.widget && active_action.widget.active_view &&
                  active_action.widget.active_view.type === 'pms'){
              options.toHide = true;
          }
      }
      this._super(status, options);
      this._toggle_visibility(!options.toHide);
  }
});

/** SYSTRAY **/
var CalendarMenu = Widget.extend({
    template: 'HotelCalendar.SettingsMenu',
    events: {
      "click a[data-action]": "perform_callback",
    },

    init: function(){
      this._super.apply(this, arguments);
    },

    start: function(){
      this.$dropdown = this.$(".o_calendar_settings_dropdown");
      return $.when(
        new Model("res.users").call("read", [[Session.uid], ["pms_show_notifications", "pms_show_pricelist", "pms_show_availability", "pms_divide_rooms_by_capacity"]])
      ).then(function(result) {
        this._show_notifications = result[0]['pms_show_notifications'];
        this._show_pricelist = result[0]['pms_show_pricelist'];
        this._show_availability = result[0]['pms_show_availability'];
        this._show_divide_rooms_by_capacity = result[0]['pms_divide_rooms_by_capacity'];
        return this.update();
      }.bind(this));
    },

    perform_callback: function (evt) {
        evt.preventDefault();
        var params = $(evt.target).data();
        var callback = params.action;

        if (callback && this[callback]) {
            this[callback](params, evt);
        } else {
            console.warn("No handler for ", callback);
        }
    },

    update: function() {
      // var view_type = this.getParent().getParent()._current_state.view_type;
      // if (view_type === 'pms') {
      //   this.do_show();
        this.$dropdown
            .empty()
            .append(QWeb.render('HotelCalendar.SettingsMenu.Global', {
                manager: this,
            }));
      // }
      // else {
      //   this.do_hide();
      // }
      return $.when();
    },

    toggle_show_adv_controls: function() {
      var $pms_search = $(document).find('#pms-search');
      if ($pms_search.position().top < 0)
      {
        var $navbar = $('.navbar');
        var toPos = $navbar.height() + parseInt($navbar.css('border-top-width'), 10) + parseInt($navbar.css('border-bottom-width'), 10);
        $pms_search.animate({
          'top': `${toPos}px`,
          'opacity': 1.0,
        }, 'fast');
      } else {
        $pms_search.animate({
          'top': `-${$pms_search.height()}px`,
          'opacity': 0.0,
        }, 'slow');
      }
    },

    toggle_show_notification: function() {
      this._show_notifications = !this._show_notifications;
      new Model('res.users').call('write', [Session.uid, {
          pms_show_notifications: this._show_notifications
      }]).then(function () {
          window.location.reload();
      });
    },

    toggle_show_pricelist: function() {
      this._show_pricelist = !this._show_pricelist;
      new Model('res.users').call('write', [Session.uid, {
          pms_show_pricelist: this._show_pricelist
      }]).then(function () {
          window.location.reload();
      });
    },

    toggle_show_availability: function() {
      this._show_availability = !this._show_availability;
      new Model('res.users').call('write', [Session.uid, {
          pms_show_availability: this._show_availability
      }]).then(function () {
          window.location.reload();
      });
    },

    toggle_show_divide_rooms_by_capacity: function() {
      this._show_divide_rooms_by_capacity = !this._show_divide_rooms_by_capacity;
      new Model('res.users').call('write', [Session.uid, {
          pms_divide_rooms_by_capacity: this._show_divide_rooms_by_capacity
      }]).then(function () {
          window.location.reload();
      });
    }
});
SystrayMenu.Items.push(CalendarMenu);

var HotelCalendarView = View.extend({
    /** VIEW OPTIONS **/
    template: "hotel_calendar.HotelCalendarView",
    display_name: _lt('Hotel Calendar'),
    icon: 'fa fa-map-marker',
    view_type: "pms",
    searchable: false,
    searchview_hidden: true,

    // Custom Options
    _view_options: {},
    _model: null,
    _hcalendar: null,
    _reserv_tooltips: {},
    _days_tooltips: [],
    _action_manager: null,
    _last_dates: [false, false],


    /** VIEW METHODS **/
    init: function(parent, dataset, fields_view, options) {
      this._super.apply(this, arguments);
      this.shown = $.Deferred();
      this.dataset = dataset;
      this.model = dataset.model;
      this.view_type = 'pms';
      this.selected_filters = [];
      this.mutex = new Utils.Mutex();
      this._model = new Model(this.dataset.model, this.dataset.context, this.dataset.domain);
      this._action_manager = this.findAncestor(function(ancestor){ return ancestor instanceof ActionManager; });

      Bus.on("notification", this, this._on_bus_signal);
    },

    start: function () {
      this.shown.done(this._do_show_init.bind(this));
      return this._super();
    },

    _do_show_init: function () {
      this.init_calendar_view();
    },

    do_show: function() {
      this.do_push_state({});
      this.shown.resolve();

      this._super();

      if (this._hcalendar && !this._is_visible) {
        // FIXME: Workaround for restore "lost" reservations (Drawn when the view is hidden)
        setTimeout(function(){
          for (var reserv of this._hcalendar._reservations) {
            var style = window.getComputedStyle(reserv._html, null);
            if (parseInt(style.width, 10) < 15 || parseInt(style.height, 10) < 15 || parseInt(style.top, 10) === 0) {
              this._hcalendar._updateReservation(reserv);
            }
          }
        }.bind(this), 300);
      }
    },

    do_hide: function() {
      this._super.apply(this, arguments);
    },

    /** CUSTOM METHODS **/
    _generate_reservation_tooltip_dict: function(tp) {
      return {
        'name': tp[0],
        'phone': tp[1],
        'arrival_hour': HotelCalendar.toMomentUTC(tp[2], ODOO_DATETIME_MOMENT_FORMAT).local().format('HH:mm'),
        'num_split': tp[3],
        'amount_total': Number(tp[4]).toLocaleString()
      };
    },

    create_calendar: function(options, pricelist, restrictions) {
        var self = this;
        // CALENDAR
        if (this._hcalendar) {
            delete this._hcalendar;
        }
        var $widget = this.$el.find("#hcal_widget");
        var $hcal = $widget.find('#hcalendar');
        if ($hcal) { $hcal.remove(); }
        $widget.empty();
        $widget.append("<div id='hcalendar'></div>"); // FIXME: Use 'hcal_widget'

        this._hcalendar = new HotelCalendar('#hcalendar', options, pricelist, restrictions, this.$el[0]);
        this._hcalendar.addEventListener('hcalOnSavePricelist', function(ev){
          var pricelist = self._hcalendar.getPricelist();
          var oparams = [false, self._hcalendar._pricelist_id, false, pricelist, {}, {}];
          new Model('hotel.calendar.management').call('save_changes', oparams).then(function(results){
              $(self._hcalendar.btnSaveChanges).removeClass('need-save');
              $('.hcal-input-changed').removeClass('hcal-input-changed');
          });
        });
        this._hcalendar.addEventListener('hcalOnMouseEnterReservation', function(ev){
          if (ev.detail.reservationObj) {
            var tp = self._reserv_tooltips[ev.detail.reservationObj.id];
            var qdict = self._generate_reservation_tooltip_dict(tp);
            $(ev.detail.reservationDiv).tooltip('destroy').tooltip({
              animation: false,
              html: true,
              placement: 'bottom',
              title: QWeb.render('HotelCalendar.TooltipReservation', qdict)
            }).tooltip('show');
          }
        });
        this._hcalendar.addEventListener('hcalOnClickReservation', function(ev){
            //var res_id = ev.detail.reservationObj.getUserData('folio_id');
            $(ev.detail.reservationDiv).tooltip('hide');
            self.call_action({
              type: 'ir.actions.act_window',
              res_model: 'hotel.reservation',
              res_id: ev.detail.reservationObj.id,
              views: [[false, 'form']]
            });
            // self._model.call('get_formview_id', [res_id, Session.user_context]).then(function(view_id){
            //     var pop = new Common.FormViewDialog(self, {
            //         res_model: 'hotel.folio',
            //         res_id: res_id,
            //         title: _t("Open: ") + ev.detail.reservationObj.title,
            //         view_id: view_id
            //         //readonly: false
            //     }).open();
            //     pop.on('write_completed', self, function(){
            //         self.trigger('changed_value');
            //     });
            // });
        });
        this._hcalendar.addEventListener('hcalOnSwapReservations', function(ev){
          var qdict = {};
          var dialog = new Dialog(self, {
              title: _t("Confirm Reservation Swap"),
              buttons: [
                  {
                    text: _t("Yes, swap it"),
                    classes: 'btn-primary',
                    close: true,
                    click: function () {
                      if (self._hcalendar.swapReservations(ev.detail.inReservs, ev.detail.outReservs)) {
                        var fromIds = _.pluck(ev.detail.inReservs, 'id');
                        var toIds = _.pluck(ev.detail.outReservs, 'id');
                        var refFromReservDiv = ev.detail.inReservs[0]._html;
                        var refToReservDiv = ev.detail.outReservs[0]._html;

                        // Animate Movement
                        for (var nreserv of ev.detail.inReservs) {
                          $(nreserv._html).animate({'top': refToReservDiv.style.top});
                        }
                        for (var nreserv of ev.detail.outReservs) {
                          $(nreserv._html).animate({'top': refFromReservDiv.style.top});
                        }
                        self._model.call('swap_reservations', [fromIds, toIds]).then(function(results){
                          var allReservs = ev.detail.inReservs.concat(ev.detail.outReservs);
                          for (nreserv of allReservs) {
                            $(nreserv._html).stop(true);
                          }
                        }).fail(function(err, errev){
                          for (var nreserv of ev.detail.inReservs) {
                            $(nreserv._html).animate({'top': refFromReservDiv.style.top}, 'fast');
                          }
                          for (var nreserv of ev.detail.outReservs) {
                            $(nreserv._html).animate({'top': refToReservDiv.style.top}, 'fast');
                          }

                          self._hcalendar.swapReservations(ev.detail.outReservs, ev.detail.inReservs);
                        });
                      } else {
                        var qdict = {};
                        var dialog = new Dialog(self, {
                          title: _t("Invalid Reservation Swap"),
                          buttons: [
                            {
                              text: _t("Oops, Ok!"),
                              classes: 'btn-primary',
                              close: true
                            }
                          ],
                          $content: QWeb.render('HotelCalendar.InvalidSwapOperation', qdict)
                        }).open();
                      }
                    }
                  },
                  {
                    text: _t("No"),
                    close: true
                  }
              ],
              $content: QWeb.render('HotelCalendar.ConfirmSwapOperation', qdict)
          }).open();
        });
        this._hcalendar.addEventListener('hcalOnCancelSwapReservations', function(ev){
          $("#btn_swap span.ntext").html(_t("START SWAP"));
          $("#btn_swap").css({
            'backgroundColor': '',
            'fontWeight': 'normal'
          });
        });
        this._hcalendar.addEventListener('hcalOnChangeReservation', function(ev){
            var newReservation = ev.detail.newReserv;
            var oldReservation = ev.detail.oldReserv;
            var oldPrice = ev.detail.oldPrice;
            var newPrice = ev.detail.newPrice;
            var folio_id = newReservation.getUserData('folio_id');

            var linkedReservs = _.find(self._hcalendar._reservations, function(item){
                return item.id !== newReservation.id && !item.unusedZone && item.getUserData('folio_id') === folio_id;
            });

            var hasChanged = false;

            var qdict = {
                ncheckin: newReservation.startDate.clone().local().format(L10N_DATETIME_MOMENT_FORMAT),
                ncheckout: newReservation.endDate.clone().local().format(L10N_DATETIME_MOMENT_FORMAT),
                nroom: newReservation.room.number,
                nprice: newPrice,
                ocheckin: oldReservation.startDate.clone().local().format(L10N_DATETIME_MOMENT_FORMAT),
                ocheckout: oldReservation.endDate.clone().local().format(L10N_DATETIME_MOMENT_FORMAT),
                oroom: oldReservation.room.number,
                oprice: oldPrice,
                hasReservsLinked: (linkedReservs && linkedReservs.length !== 0)?true:false
            };
            var dialog = new Dialog(self, {
                title: _t("Confirm Reservation Changes"),
                buttons: [
                    {
                        text: _t("Yes, change it"),
                        classes: 'btn-primary',
                        close: true,
                        disabled: !newReservation.id,
                        click: function () {
                            var roomId = newReservation.room.id;
                            if (newReservation.room.overbooking) {
                              roomId = +newReservation.room.id.substr(newReservation.room.id.indexOf('@')+1);
                            }
                            var write_values = {
                                'checkin': newReservation.startDate.format(ODOO_DATETIME_MOMENT_FORMAT),
                                'checkout': newReservation.endDate.format(ODOO_DATETIME_MOMENT_FORMAT),
                                'product_id': roomId,
                                'overbooking': newReservation.room.overbooking
                            };
                            new Model('hotel.reservation').call('write', [[newReservation.id], write_values]).then(function(result){
                              // Remove OB Room Row?
                              if (oldReservation.room.overbooking) {
                                self._hcalendar.removeOBRoomRow(oldReservation);
                              }
                            }).fail(function(err, errev){
                                self._hcalendar.replaceReservation(newReservation, oldReservation);
                            });
                            // Workarround for dispatch room lines regeneration
                            new Model('hotel.reservation').call('on_change_checkin_checkout_product_id', [[newReservation.id], false]);
                            hasChanged = true;
                        }
                    },
                    {
                        text: _t("No"),
                        close: true,
                    }
                ],
                $content: QWeb.render('HotelCalendar.ConfirmReservationChanges', qdict)
            }).open();
            dialog.$modal.on('hide.bs.modal', function(e){
              if (!hasChanged) {
                self._hcalendar.replaceReservation(newReservation, oldReservation);
              }
            });
        });
        this._hcalendar.addEventListener('hcalOnUpdateSelection', function(ev){
        	for (var td of ev.detail.old_cells) {
        		$(td).tooltip('destroy');
        	}
        	if (ev.detail.cells.length > 1) {
	        	var last_cell = ev.detail.cells[ev.detail.cells.length-1];
	        	var date_cell_start = HotelCalendar.toMoment(self._hcalendar.etable.querySelector(`#${ev.detail.cells[0].dataset.hcalParentCell}`).dataset.hcalDate);
	        	var date_cell_end = HotelCalendar.toMoment(self._hcalendar.etable.querySelector(`#${last_cell.dataset.hcalParentCell}`).dataset.hcalDate);
            var parentRow = document.querySelector(`#${ev.detail.cells[0].dataset.hcalParentRow}`);
            var room = self._hcalendar.getRoom(parentRow.dataset.hcalRoomObjId);
            if (room.overbooking) {
              return;
            }
            var nights = date_cell_end.diff(date_cell_start, 'days');
	        	var qdict = {
	        		'total_price': Number(ev.detail.totalPrice).toLocaleString(),
	        		'nights': nights
	        	};
	        	$(last_cell).tooltip({
	                animation: false,
	                html: true,
	                placement: 'top',
	                title: QWeb.render('HotelCalendar.TooltipSelection', qdict)
	            }).tooltip('show');
        	}
        });
        this._hcalendar.addEventListener('hcalOnChangeSelection', function(ev){
            var parentRow = document.querySelector(`#${ev.detail.cellStart.dataset.hcalParentRow}`);
            var parentCellStart = document.querySelector(`#${ev.detail.cellStart.dataset.hcalParentCell}`);
            var parentCellEnd = document.querySelector(`#${ev.detail.cellEnd.dataset.hcalParentCell}`);
            var startDate = HotelCalendar.toMoment(parentCellStart.dataset.hcalDate);
            var endDate = HotelCalendar.toMoment(parentCellEnd.dataset.hcalDate);
            var room = self._hcalendar.getRoom(parentRow.dataset.hcalRoomObjId);
            if (room.overbooking) {
              return;
            }
            var numBeds = (room.shared || self._hcalendar.getOptions('divideRoomsByCapacity'))?(ev.detail.cellEnd.dataset.hcalBedNum - ev.detail.cellStart.dataset.hcalBedNum)+1:room.capacity;
            var HotelFolioObj = new Model('hotel.folio');

            if (numBeds <= 0) {
                return;
            }

            // Normalize Dates
            if (startDate.isAfter(endDate)) {
                var tt = endDate;
                endDate = startDate;
                startDate = tt;
            }

            var def_arrival_hour = self._view_options['default_arrival_hour'].split(':');
            var def_departure_hour = self._view_options['default_departure_hour'].split(':');
            startDate.set({'hour': def_arrival_hour[0], 'minute': def_arrival_hour[1], 'second': 0});
            endDate.set({'hour': def_departure_hour[0], 'minute': def_departure_hour[1], 'second': 0});

            var context = {
              'default_checkin': startDate.utc().format(ODOO_DATETIME_MOMENT_FORMAT),
              'default_checkout': endDate.utc().format(ODOO_DATETIME_MOMENT_FORMAT),
              'default_adults': numBeds,
              'default_children': 0,
              'default_product_id': room.id,
            };

            Object.entries(self.dataset.context).forEach(([key, value]) => {
                if(typeof value !== 'object')
                    context[key] = value
            });

            var popCreate = new Common.FormViewDialog(self, {
                res_model: 'hotel.reservation',
                context: context,
                title: _t("Create: ") + _t("Reservation"),
                initial_view: "form",
                disable_multiple_selection: true,
            }).open();
        });

        this._hcalendar.addEventListener('hcalOnDateChanged', function(ev){
          var $dateTimePickerBegin = this.$el.find('#pms-search #date_begin');
          var $dateTimePickerEnd = this.$el.find('#pms-search #date_end');
          $dateTimePickerBegin.data("ignore_onchange", true);
          $dateTimePickerBegin.data("DateTimePicker").setDate(ev.detail.date_begin.local().add(1, 'd'));
          $dateTimePickerEnd.data("ignore_onchange", true);
          $dateTimePickerEnd.data("DateTimePicker").setDate(ev.detail.date_end.local());
          this.reload_hcalendar_reservations(false);
        }.bind(this));
    },

    generate_hotel_calendar: function(days){
        var self = this;

        /** DO MAGIC **/
        var domains = this.generate_domains();
        var oparams = [
          domains['dates'][0].format(ODOO_DATETIME_MOMENT_FORMAT),
          domains['dates'][1].format(ODOO_DATETIME_MOMENT_FORMAT)
        ];
        var kwargs = {
            "domain": this._model._domain,
        };
        this._model.call('get_hcalendar_all_data', oparams, kwargs).then(function(results){
            self._days_tooltips = results['events'];
            self._reserv_tooltips = results['tooltips'];
            var rooms = [];
            for (var r of results['rooms']) {
                var nroom = new HRoom(
                    r[0], // Id
                    r[1], // Name
                    r[2], // Capacity
                    r[4], // Category
                    r[5], // Shared Room
                    r[6]  // Price
                );
                nroom.addUserData({
                    'categ_id': r[3],
                    'price_from': r[6][0] === 'fixed'?`${r[6][1]}${CURRENCY_SYMBOL} (${_t('Fixed Price')})`:r[6][3],
                    'inside_rooms': r[7],
                    'inside_rooms_ids': r[8],
                    'floor_id': r[9],
                    'amenities': r[10]
                });
                rooms.push(nroom);
            }

            self.create_calendar({
                startDate: HotelCalendar.toMomentUTC(domains['dates'][0], ODOO_DATETIME_MOMENT_FORMAT),
                days: self._view_options['days'] + 1,
                rooms: rooms,
                endOfWeek: parseInt(self._view_options['eday_week']) || 6,
                divideRoomsByCapacity: self._view_options['divide_rooms_by_capacity'] || false,
                allowInvalidActions: self._view_options['allow_invalid_actions'] || false,
                assistedMovement: self._view_options['assisted_movement'] || false,
                showPricelist: self._view_options['show_pricelist'] || false,
                showAvailability: self._view_options['show_availability'] || false,
                showNumRooms: self._view_options['show_num_rooms'] || 0,
                endOfWeekOffset: self._view_options['eday_week_offset'] || 0
            }, results['pricelist'], results['restrictions']);

            // TODO: Not read this... do the change!!
            var reservs = [];
            for (var r of results['reservations']) {
                var room = self._hcalendar.getRoom(r[0], r[15], r[1]);
                // need create a overbooking row?
                if (!room && r[15]) {
                  room = self._hcalendar.createOBRoom(self._hcalendar.getRoom(r[0]), r[1]);
                  self._hcalendar.createOBRoomRow(room);
                }
                if (!room) {
                  console.warn(`Can't found a room for the reservation '${r[0]}'!`);
                  continue;
                }

                var nreserv = new HReservation({
                  'id': r[1],
                  'room': room,
                  'title': r[2],
                  'adults': r[3],
                  'childrens': r[4],
                  'startDate': HotelCalendar.toMomentUTC(r[5], ODOO_DATETIME_MOMENT_FORMAT),
                  'endDate': HotelCalendar.toMomentUTC(r[6], ODOO_DATETIME_MOMENT_FORMAT),
                  'color': r[8],
                  'colorText': r[9],
                  'splitted': r[10],
                  'readOnly': r[12],
                  'fixDays': r[13],
                  'fixRooms': r[14],
                  'unusedZone': false,
                  'linkedId': false,
                  'overbooking': r[15],
                });
                nreserv.addUserData({'folio_id': r[7]});
                nreserv.addUserData({'parent_reservation': r[11]});
                reservs.push(nreserv);
            }
            self._hcalendar.setReservations(reservs);
            self._assign_extra_info();
        });
    },

    _assign_extra_info: function() {
    	var self = this;
      $(this._hcalendar.etable).find('.hcal-cell-room-type-group-item.btn-hcal-3d').on("mouseenter", function(){
      	var $this = $(this);
      	var room = self._hcalendar.getRoom($this.parent().data("hcalRoomObjId"));
        if (room.overbooking) {
          $this.tooltip({
                animation: true,
                html: true,
                placement: 'right',
                title: QWeb.render('HotelCalendar.TooltipRoomOverbooking', {'name': room.number})
            }).tooltip('show');
          return;
        } else {
        	var qdict = {
    			  'price_from': room.getUserData('price_from'),
            'inside_rooms': room.getUserData('inside_rooms'),
            'num_inside_rooms': room.getUserData('inside_rooms').length,
            'name': room.number
        	};
        	$this.tooltip({
                animation: true,
                html: true,
                placement: 'right',
                title: QWeb.render('HotelCalendar.TooltipRoom', qdict)
            }).tooltip('show');
        }
      });

      $(this._hcalendar.etableHeader).find('.hcal-cell-header-day').each(function(index, elm){
        var $elm = $(elm);
        var cdate = HotelCalendar.toMoment($elm.data('hcalDate'), L10N_DATE_MOMENT_FORMAT);
        var data = _.filter(self._days_tooltips, function(item) {
          var ndate = HotelCalendar.toMoment(item[2], ODOO_DATE_MOMENT_FORMAT);
          return ndate.isSame(cdate, 'd');
        });
        if (data.length > 0) {
          $elm.addClass('hcal-event-day');
          $elm.prepend("<i class='fa fa-bell' style='margin-right: 0.1em'></i>");
          $elm.on("mouseenter", function(data){
            var $this = $(this);
            if (data.length > 0) {
              var qdict = {
                'date': $this.data('hcalDate'),
                'events': _.map(data, function(item){
                  return {
                    'name': item[1],
                    'date': item[2],
                    'location': item[3]
                  };
                })
              };
              $this.attr('title', '');
              $this.tooltip({
                  animation: true,
                  html: true,
                  placement: 'bottom',
                  title: QWeb.render('HotelCalendar.TooltipEvent', qdict)
              }).tooltip('show');
            }
          }.bind(elm, data));
        }
      });
    },

    call_action: function(action) {
        this._action_manager.do_action(action);
    },

    update_buttons_counter: function() {
        var self = this;
        var domain = [];

        var HotelFolioObj = new Model('hotel.reservation');

         //~ // Checkouts Button
        domain = [['is_checkout', '=', true]];
        HotelFolioObj.call('search_count', [domain]).then(function(count){
          var $ninfo = self.$el.find('#pms-menu #btn_action_checkout div.ninfo');
          var $badge_checkout = $ninfo.find('.badge');
          if (count > 0) {
              $badge_checkout.text(count);
              $badge_checkout.parent().show();
              $ninfo.show();
          } else {
              $ninfo.hide();
          }
        });

        // Checkins Button
        domain = [['is_checkin', '=', true]];
        HotelFolioObj.call('search_count', [domain]).then(function(count){
          var $ninfo = self.$el.find('#pms-menu #btn_action_checkin div.ninfo');
          var $badge_checkin = $ninfo.find('.badge');
          if (count > 0) {
              $badge_checkin.text(count);
              $badge_checkin.parent().show();
              $ninfo.show();
          } else {
              $ninfo.hide();
          }
        });

        //~ // Charges Button
        //~ domain = [['invoices_amount','>',0 ],['room_lines.checkout','<=', moment().startOf('day').utc().format(ODOO_DATETIME_MOMENT_FORMAT)]];
        //~ HotelFolioObj.call('search_count', [domain]).then(function(count){
        	//~ var $ninfo = self.$el.find('#pms-menu #btn_action_paydue div.ninfo');
        	//~ var $badge_charges = self.$el.find('#pms-menu #btn_action_paydue .badge');
        	//~ if (count > 0) {
        		//~ $badge_charges.text(count);
        		//~ $badge_charges.parent().show();
        		//~ $ninfo.show();
            //~ } else {
            	//~ $ninfo.hide();
            //~ }
       //~ });

        // OverBookings
        domain = [['overbooking', '=', true], ['state', 'not in', ['cancelled']]];
        this._model.call('search_count', [domain]).then(function(count){
          var $ninfo = self.$el.find('#pms-menu #btn_swap div.ninfo');
          var $badge_swap = $ninfo.find('.badge');
          if (count > 0) {
              $badge_swap.text(count);
              $badge_swap.parent().show();
              $ninfo.show();
          } else {
              $ninfo.hide();
          }
        });
    },

    init_calendar_view: function(){
        var self = this;

        /** VIEW CONTROLS INITIALIZATION **/
        // DATE TIME PICKERS
        var DTPickerOptions = {
            viewMode: 'months',
            icons : {
                time: 'fa fa-clock-o',
                date: 'fa fa-calendar',
                up: 'fa fa-chevron-up',
                down: 'fa fa-chevron-down'
               },
            language : moment.locale(),
            locale : moment.locale(),
            format : L10N_DATE_MOMENT_FORMAT,
            disabledHours: true // TODO: Odoo uses old datetimepicker version
        };
        var $dateTimePickerBegin = this.$el.find('#pms-search #date_begin');
        var $dateTimePickerEnd = this.$el.find('#pms-search #date_end');
        $dateTimePickerBegin.datetimepicker(DTPickerOptions);
        $dateTimePickerEnd.datetimepicker($.extend({}, DTPickerOptions, { 'useCurrent': false }));
        $dateTimePickerBegin.on("dp.change", function (e) {
            $dateTimePickerEnd.data("DateTimePicker").setMinDate(e.date.add(3,'d'));
            $dateTimePickerEnd.data("DateTimePicker").setMaxDate(e.date.add(2,'M'));
            $dateTimePickerBegin.data("DateTimePicker").hide(); // TODO: Odoo uses old datetimepicker version
            self.on_change_filter_date(true);
        });
        $dateTimePickerEnd.on("dp.change", function (e) {
            $dateTimePickerEnd.data("DateTimePicker").hide(); // TODO: Odoo uses old datetimepicker version
            self.on_change_filter_date(false);
        });
        //this.$el.find('#pms-search #cal-pag-selector').datetimepicker($.extend({}, DTPickerOptions, {
        //  'useCurrent': true,
        //}));

        //var $dateTimePickerSelector = this.$el.find('#pms-search #cal-pag-selector-calendar');
        //$dateTimePickerSelector.datetimepicker($.extend({}, DTPickerOptions, {'inline':true, 'sideBySide': false}));
        //$dateTimePickerSelector.on("dp.change", function (e) {
        //  console.log(e);
            /*var date_begin = moment(this.data("DateTimePicker").getDate());
            var days = moment(date_begin).daysInMonth();
            var date_end = date_begin.clone().add(days, 'd');
            $dateTimePickerBegin.data("DateTimePicker").setDate(date_begin);
            $dateTimePickerEnd.data("DateTimePicker").setDate(date_end);*/
        //});

        var date_begin = moment().startOf('day');
        var days = date_begin.daysInMonth();
        var date_end = date_begin.clone().add(days, 'd').endOf('day');
        $dateTimePickerBegin.data("ignore_onchange", true);
        $dateTimePickerBegin.data("DateTimePicker").setDate(date_begin);
        $dateTimePickerEnd.data("DateTimePicker").setDate(date_end);
        this._last_dates = this.generate_domains()['dates'];

        // Initial State
        var $pms_search = this.$el.find('#pms-search');
        $pms_search.css({
          'top': `-100%`,
          'opacity': 0.0,
        });
        // Show search (Alt+S)
        $(document).keydown(function(ev){
          if (ev.altKey){
            if (ev.key == 'x' || ev.key == 'X'){
              self.toggle_pms_search();
            }
          }
        });

        /* TOUCH EVENTS */
        this.$el.on('touchstart', function(ev){
          var orgEvent = ev.originalEvent;
          this._mouseEventStartPos = [orgEvent.touches[0].screenX, orgEvent.touches[0].screenY];
        });
        this.$el.on('touchend', function(ev){
          var orgEvent = ev.originalEvent;
          if (orgEvent.changedTouches.length > 2) {
            var mousePos = [orgEvent.changedTouches[0].screenX, orgEvent.changedTouches[0].screenY];
            var mouseDiffX = mousePos[0] - this._mouseEventStartPos[0];
            var moveLength = 40;
            var date_begin = false;
            var days = orgEvent.changedTouches.length == 3 && 7 || 1;
            if (mouseDiffX < -moveLength) {
              date_begin = $dateTimePickerBegin.data("DateTimePicker").getDate().set({'hour': 0, 'minute': 0, 'second': 0}).clone().add(days, 'd');
            }
            else if (mouseDiffX > moveLength) {
              date_begin = $dateTimePickerBegin.data("DateTimePicker").getDate().set({'hour': 0, 'minute': 0, 'second': 0}).clone().subtract(days, 'd');
            }
            if (date_begin) {
              var date_end = date_begin.clone().add(self._view_options['days'], 'd').endOf('day');
              $dateTimePickerEnd.data("ignore_onchange", true);
              $dateTimePickerEnd.data("DateTimePicker").setDate(date_end);
              $dateTimePickerBegin.data("DateTimePicker").setDate(date_begin);
            }
          }
        });

        /* BUTTONS */
        var $button = this.$el.find('#pms-menu #btn_action_bookings');
        $button.on('click', function(ev){ self._open_bookings_tree(); });
        var $btnInput = this.$el.find('#pms-menu #bookings_search');
        $btnInput.on('keypress', function(ev){
          if (ev.keyCode === 13) {
             self._open_bookings_tree();
          }
        });

        this.update_buttons_counter();
        this.$el.find("button[data-action]").on('click', function(ev){
          self.call_action(this.dataset.action);
        });

        this.$el.find("#btn_swap").on('click', function(ev){
          var hcalSwapMode = self._hcalendar.getSwapMode();
          if (hcalSwapMode === HotelCalendar.MODE.NONE) {
            self._hcalendar.setSwapMode(HotelCalendar.MODE.SWAP_FROM);
            $("#btn_swap span.ntext").html(_t("CONTINUE"));
            $("#btn_swap").css({
              'backgroundColor': 'rgb(145, 255, 0)',
              'fontWeight': 'bold'
            });
          } else if (self._hcalendar.getReservationAction().inReservations.length > 0 && hcalSwapMode === HotelCalendar.MODE.SWAP_FROM) {
            self._hcalendar.setSwapMode(HotelCalendar.MODE.SWAP_TO);
            $("#btn_swap span.ntext").html(_t("END"));
            $("#btn_swap").css({
              'backgroundColor': 'orange',
              'fontWeight': 'bold'
            });
          } else {
            self._hcalendar.setSwapMode(HotelCalendar.MODE.NONE);
            $("#btn_swap span.ntext").html(_t("START SWAP"));
            $("#btn_swap").css({
              'backgroundColor': '',
              'fontWeight': ''
            });
          }
        });
//        this.$el.find("#btn_action_refresh").on('click', function(ev){
//            window.location.reload();
//        });

        /** RENDER CALENDAR **/
        this._model.call('get_hcalendar_settings', [false]).then(function(results){
        	self._view_options = results;
          var date_begin = moment().startOf('day');
          if (['xs', 'md'].indexOf(self._find_bootstrap_environment()) >= 0) {
            self._view_options['days'] = 7;
          } else {
            self._view_options['days'] = (self._view_options['days'] !== 'month')?parseInt(self._view_options['days']):date_begin.daysInMonth();
          }
          var date_end = date_begin.clone().add(self._view_options['days'], 'd').endOf('day');
          var $dateTimePickerBegin = self.$el.find('#pms-search #date_begin');
          var $dateTimePickerEnd = self.$el.find('#pms-search #date_end');
          //$dateTimePickerBegin.data("ignore_onchange", true);
          $dateTimePickerBegin.data("DateTimePicker").setDate(date_begin);
          //$dateTimePickerEnd.data("ignore_onchange", true);
          $dateTimePickerEnd.data("DateTimePicker").setDate(date_end);
          self._last_dates = self.generate_domains()['dates'];

        	self.generate_hotel_calendar();
        });

        /** DATABASE QUERIES **/
        // Get Types
        new Model('hotel.room.type').query(['cat_id','name']).all().then(function(resultsHotelRoomType){
            var $list = self.$el.find('#pms-search #type_list');
            $list.html('');
            resultsHotelRoomType.forEach(function(item, index){
                $list.append(`<option value="${item.cat_id[0]}">${item.name}</option>`);
            });
            $list.select2({
              theme: "classic"
            });
            $list.on('change', function(ev){
              _.defer(function(){
                this._apply_filters();
              }.bind(self));
            });
        });
        // Get Floors
        new Model('hotel.floor').query(['id','name']).all().then(function(resultsHotelFloor){
            var $list = self.$el.find('#pms-search #floor_list');
            $list.html('');
            resultsHotelFloor.forEach(function(item, index){
                $list.append(`<option value="${item.id}">${item.name}</option>`);
            });
            $list.select2();
            $list.on('change', function(ev){
              _.defer(function(){
                this._apply_filters();
              }.bind(self));
            });
        });
        // Get Amenities
        new Model('hotel.room.amenities').query(['id','name']).all().then(function(resultsHotelRoomAmenities){
            var $list = self.$el.find('#pms-search #amenities_list');
            $list.html('');
            resultsHotelRoomAmenities.forEach(function(item, index){
                $list.append(`<option value="${item.id}">${item.name}</option>`);
            });
            $list.select2();
            $list.on('change', function(ev){
              _.defer(function(){
                this._apply_filters();
              }.bind(self));
            });
        });
        // Get Virtual Rooms
        new Model('hotel.virtual.room').query(['id','name']).all().then(function(resultsHotelVirtualRooms){
            var $list = self.$el.find('#pms-search #virtual_list');
            $list.html('');
            resultsHotelVirtualRooms.forEach(function(item, index){
                $list.append(`<option value="${item.id}">${item.name}</option>`);
            });
            $list.select2();
            $list.on('change', function(ev){
              _.defer(function(){
                this._apply_filters();
              }.bind(self));
            });
        });

        return $.when();
    },

    toggle_pms_search: function() {
      var $pms_search = this.$el.find('#pms-search');
      if ($pms_search.position().top < 0)
      {
        var $navbar = $('.navbar');
        var toPos = $navbar.height() + parseInt($navbar.css('border-top-width'), 10) + parseInt($navbar.css('border-bottom-width'), 10);
        $pms_search.animate({
          'top': `${toPos}px`,
          'opacity': 1.0,
        }, 'fast');
      } else {
        $pms_search.animate({
          'top': `-${$pms_search.height()}px`,
          'opacity': 0.0,
        }, 'slow');
      }
    },

    _generate_bookings_domain: function(tsearch) {
      var domain = [];
      domain.push('|', '|', '|', '|',
                  ['partner_id.name', 'ilike', tsearch],
                  ['partner_id.mobile', 'ilike', tsearch],
                  ['partner_id.vat', 'ilike', tsearch],
                  ['partner_id.email', 'ilike', tsearch],
                  ['partner_id.phone', 'ilike', tsearch]);
      return domain;
    },

    _open_bookings_tree: function() {
      var $elm = this.$el.find('#pms-menu #bookings_search');
      var searchQuery = $elm.val();
      var domain = false;
      if (searchQuery) {
        domain = this._generate_bookings_domain(searchQuery);
      }

      this.call_action({
        type: 'ir.actions.act_window',
        view_mode: 'form',
        view_type: 'tree,form',
        res_model: 'hotel.reservation',
        views: [[false, 'list'], [false, 'form']],
        domain: domain,
        name: searchQuery?'Reservations for ' + searchQuery:'All Reservations'
      });

      $elm.val('');
    },

    on_change_filter_date: function(isStartDate) {
        isStartDate = isStartDate || false;
        var $dateTimePickerBegin = this.$el.find('#pms-search #date_begin');
        var $dateTimePickerEnd = this.$el.find('#pms-search #date_end');

        // FIXME: Hackish onchange ignore (Used when change dates from code)
        if ($dateTimePickerBegin.data("ignore_onchange") || $dateTimePickerEnd.data("ignore_onchange")) {
            $dateTimePickerBegin.data("ignore_onchange", false);
            $dateTimePickerEnd.data("ignore_onchange", false)
            return true;
        }

        var date_begin = $dateTimePickerBegin.data("DateTimePicker").getDate().set({'hour': 0, 'minute': 0, 'second': 0}).clone().utc();

        if (this._hcalendar && date_begin) {
            if (isStartDate) {
                var ndate_end = date_begin.clone().add(this._view_options['days'], 'd');
                $dateTimePickerEnd.data("ignore_onchange", true);
                $dateTimePickerEnd.data("DateTimePicker").setDate(ndate_end.local());
            }

            var date_end = $dateTimePickerEnd.data("DateTimePicker").getDate().set({'hour': 23, 'minute': 59, 'second': 59}).clone().utc();
            this._hcalendar.setStartDate(date_begin, this._hcalendar.getDateDiffDays(date_begin, date_end), false, function(){
              _.defer(function(){ this.reload_hcalendar_reservations(false); }.bind(this));
            }.bind(this));
        }
    },

    _on_bus_signal: function(notifications) {
        if (!this._hcalendar) {
          return;
        }
        var need_reload_pricelists = false;
        var need_update_counters = false;
        var nreservs = []
        for (var notif of notifications) {
          if (notif[0][1] === 'hotel.reservation') {
            switch (notif[1]['type']) {
              case 'reservation':
                var reserv = notif[1]['reservation'];
                // Only show notifications of other users
                // if (notif[1]['subtype'] !== 'noshow' && this._view_options['show_notifications'] && notif[1]['userid'] != this.dataset.context.uid) {
                //   var qdict = _.clone(reserv);
                //   qdict = _.extend(qdict, {
                //     'checkin': HotelCalendar.toMomentUTC(qdict['checkin'], ODOO_DATETIME_MOMENT_FORMAT).clone().local().format(L10N_DATETIME_MOMENT_FORMAT), // UTC -> Local
                //     'checkout': HotelCalendar.toMomentUTC(qdict['checkout'], ODOO_DATETIME_MOMENT_FORMAT).clone().local().format(L10N_DATETIME_MOMENT_FORMAT), // UTC -> Local
                //     'username': notif[1]['username'],
                //     'userid': notif[1]['userid']
                //   });
                //   var msg = QWeb.render('HotelCalendar.Notification', qdict);
                //   if (notif[1]['subtype'] === "notify") {
                //       this.do_notify(notif[1]['title'], msg, true);
                //   } else if (notif[1]['subtype'] === "warn") {
                //       this.do_warn(notif[1]['title'], msg, true);
                //   }
                // }

                // Create/Update/Delete reservation
                if (notif[1]['action'] === 'unlink' || reserv['state'] === 'cancelled') {
                  this._hcalendar.removeReservation(reserv['reserv_id'], true);
                  this._reserv_tooltips = _.pick(this._reserv_tooltips, function(value, key, obj){ return key != reserv['reserv_id']; });
                  nreservs = _.reject(nreservs, function(item){ return item.id == reserv['reserv_id']; });
                } else {
                  nreservs = _.reject(nreservs, {'id': reserv['reserv_id']}); // Only like last changes
                  var room = this._hcalendar.getRoom(reserv['product_id'], reserv['overbooking'], reserv['reserv_id']);
                  // need create a overbooking row?
                  if (!room && reserv['overbooking']) {
                    room = this._hcalendar.createOBRoom(this._hcalendar.getRoom(reserv['product_id']), reserv['reserv_id']);
                    this._hcalendar.createOBRoomRow(room);
                  }
                  if (!room) {
                    console.warn(`Can't found a room for the reservation '${reserv['reserv_id']}'!`);
                    continue;
                  }
                  if (room) {
                    var nreserv = new HReservation({
                      'id': reserv['reserv_id'],
                      'room': room,
                      'title': reserv['partner_name'],
                      'adults': reserv['adults'],
                      'childrens': reserv['children'],
                      'startDate': HotelCalendar.toMomentUTC(reserv['checkin'], ODOO_DATETIME_MOMENT_FORMAT),
                      'endDate': HotelCalendar.toMomentUTC(reserv['checkout'], ODOO_DATETIME_MOMENT_FORMAT),
                      'color': reserv['reserve_color'],
                      'colorText': reserv['reserve_color_text'],
                      'splitted': reserv['splitted'],
                      'readOnly': reserv['read_only'],
                      'fixDays': reserv['fix_days'],
                      'fixRooms': reserv['fix_rooms'],
                      'unusedZone': false,
                      'linkedId': false,
                      'overbooking': reserv['overbooking'],
                    });
                    nreserv.addUserData({'folio_id': reserv['folio_id']});
                    nreserv.addUserData({'parent_reservation': reserv['parent_reservation']});
                    this._reserv_tooltips[reserv['reserv_id']] = notif[1]['tooltip'];
                    nreservs.push(nreserv);
                  }
                }
                need_update_counters = true;
                break;
              case 'pricelist':
                this._hcalendar.addPricelist(notif[1]['price']);
                break;
              case 'restriction':
                this._hcalendar.addRestrictions(notif[1]['restriction']);
                break;
              default:
                // Do Nothing
            }
          }
        }
        if (nreservs.length > 0) {
          this._hcalendar.addReservations(nreservs);
        }
        if (need_update_counters) {
          this.update_buttons_counter();
        }
    },

    reload_hcalendar_reservations: function(clearReservations) {
        var self = this;
        var domains = this.generate_domains();
        // Clip dates
        var dfrom = domains['dates'][0].clone(),
        	dto = domains['dates'][1].clone();
        if (domains['dates'][0].isBetween(this._last_dates[0], this._last_dates[1], 'days') && domains['dates'][1].isAfter(this._last_dates[1], 'day')) {
        	dfrom = this._last_dates[1].clone().local().startOf('day').utc();
        } else if (this._last_dates[0].isBetween(domains['dates'][0], domains['dates'][1], 'days') && this._last_dates[1].isAfter(domains['dates'][0], 'day')) {
        	dto = this._last_dates[0].clone().local().endOf('day').utc();
        } else {
          clearReservations = true;
        }

        var oparams = [
          dfrom.format(ODOO_DATETIME_MOMENT_FORMAT),
          dto.format(ODOO_DATETIME_MOMENT_FORMAT),
          false
        ];
        this._model.call('get_hcalendar_all_data', oparams).then(function(results){
            self._merge_days_tooltips(results['events']);
            self._reserv_tooltips = _.extend(self._reserv_tooltips, results['tooltips']);
            var reservs = [];
            for (var r of results['reservations']) {
              var room = self._hcalendar.getRoom(r[0], r[15], r[1]);
              // need create a overbooking row?
              if (!room && r[15]) {
                room = self._hcalendar.createOBRoom(self._hcalendar.getRoom(r[0]), r[1]);
                self._hcalendar.createOBRoomRow(room);
              }
              if (!room) {
                console.warn(`Can't found a room for the reservation '${r[0]}'!`);
                continue;
              }
              var nreserv = new HReservation({
                'id': r[1],
                'room': room,
                'title': r[2],
                'adults': r[3],
                'childrens': r[4],
                'startDate': HotelCalendar.toMomentUTC(r[5], ODOO_DATETIME_MOMENT_FORMAT),
                'endDate': HotelCalendar.toMomentUTC(r[6], ODOO_DATETIME_MOMENT_FORMAT),
                'color': r[8],
                'colorText': r[9],
                'splitted': r[10],
                'readOnly': r[12] || false,
                'fixDays': r[13] || false,
                'fixRooms': r[14] || false,
                'unusedZone': false,
                'linkedId': false,
                'overbooking': r[15],
              });
              nreserv.addUserData({'folio_id': r[7]});
              nreserv.addUserData({'parent_reservation': r[11]});
              reservs.push(nreserv);
            }

            self._hcalendar.addPricelist(results['pricelist']);
            self._hcalendar.addRestrictions(results['restrictions']);
            if (clearReservations) {
              self._hcalendar.setReservations(reservs);
            } else {
              self._hcalendar.addReservations(reservs);
            }

            self._assign_extra_info();
        });
        this._last_dates = domains['dates'];
        this.update_buttons_counter();
    },

    _apply_filters: function() {
      var category = _.map(this.$el.find('#pms-search #type_list').val(), function(item){ return +item; });
      var floor = _.map(this.$el.find('#pms-search #floor_list').val(), function(item){ return +item; });
      var amenities = _.map(this.$el.find('#pms-search #amenities_list').val(), function(item){ return +item; });
      var virtual = _.map(this.$el.find('#pms-search #virtual_list').val(), function(item){ return +item; });
      var domain = [];
      if (category && category.length > 0) {
        domain.push(['categ_id', 'in', category]);
      }
      if (floor && floor.length > 0) {
        domain.push(['floor_id', 'in', floor]);
      }
      if (amenities && amenities.length > 0) {
        domain.push(['amenities', 'in', amenities]);
      }
      if (virtual && virtual.length > 0) {
        domain.push(['inside_rooms_ids', 'some', virtual]);
      }

      this._hcalendar.setDomain(HotelCalendar.DOMAIN.ROOMS, domain);
    },

    generate_domains: function() {
        var $dateTimePickerBegin = this.$el.find('#pms-search #date_begin');
        var $dateTimePickerEnd = this.$el.find('#pms-search #date_end');

        var date_begin = $dateTimePickerBegin.data("DateTimePicker").getDate().set({'hour': 0, 'minute': 0, 'second': 0}).clone().utc();
        var date_end = $dateTimePickerEnd.data("DateTimePicker").getDate().set({'hour': 23, 'minute': 59, 'second': 59}).clone().utc();

        return {
            'dates': [date_begin, date_end]
        };
    },

    _merge_days_tooltips: function(new_tooltips) {
      for (var nt of new_tooltips) {
        var fnt = _.find(this._days_tooltips, function(item) { return item[0] === nt[0]});
        if (fnt) {
          fnt = nt;
        } else {
          this._days_tooltips.push(nt);
        }
      }
    },

    _find_bootstrap_environment: function() {
        var envs = ['xs', 'sm', 'md', 'lg'];

        var $el = $('<div>');
        $el.appendTo($('body'));

        for (var i = envs.length - 1; i >= 0; i--) {
            var env = envs[i];

            $el.addClass('hidden-'+env);
            if ($el.is(':hidden')) {
                $el.remove();
                return env;
            }
        }
    }
});

Core.view_registry.add('pms', HotelCalendarView);
return HotelCalendarView;

});
