# -*- coding: utf-8 -*-
##############################################################################
#
#    OpenERP, Open Source Management Solution
#    Copyright (C) 2017 Solucións Aloxa S.L. <info@aloxa.eu>
#
#    This program is free software: you can redistribute it and/or modify
#    it under the terms of the GNU General Public License as published by
#    the Free Software Foundation, either version 3 of the License, or
#    (at your option) any later version.
#
#    This program is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU General Public License for more details.
#
#    You should have received a copy of the GNU General Public License
#    along with this program.  If not, see <http://www.gnu.org/licenses/>.
#
##############################################################################

from openerp import models, fields, api
from ..wubook import DEFAULT_WUBOOK_DATE_FORMAT


class ImportPlanRestrictionsWizard(models.TransientModel):
    _name = 'wubook.wizard.plan.restrictions'

    date_start = fields.Datetime('Start Date', required=True)
    date_end = fields.Datetime('End Date', required=True)

    @api.multi
    def import_plan_restrictions(self):
        restriction = self.env['reservation.restriction'].browse(self.env.context.get('active_id'))
        if restriction:
            for record in self:
                date_start_dt = fields.Datetime.from_string(record.date_start)
                date_end_dt = fields.Datetime.from_string(record.date_end)
                self.env['wubook'].fetch_rplan_restrictions(restriction.wpid,
                                                            date_start_dt.strftime(DEFAULT_WUBOOK_DATE_FORMAT),
                                                            date_end_dt.strftime(DEFAULT_WUBOOK_DATE_FORMAT))
        return True
