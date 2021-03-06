# -*- coding: utf-8 -*-
##############################################################################
#
#    OpenERP, Open Source Management Solution
#    Copyright (C) 2018 Alda Hotels <informatica@aldahotels.com>
#                       Jose Luis Algara <osotranquilo@gmail.com>
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
import base64
import datetime
from openerp.tools.translate import _

import logging
_logger = logging.getLogger(__name__)


class Wizard(models.TransientModel):
    _name = 'police.wizard'

    download_date = fields.Date('Date', required=True)
    download_num = fields.Char('Correlative number', required=True, size=3,
                               help='Number provided by the police')
    txt_filename = fields.Char()
    txt_binary = fields.Binary()
    txt_message = fields.Char()

    @api.one
    def generate_file(self):
        compa = self.env.user.company_id
        if compa.police is not False and compa.property_name is not False:
            lines = self.env['cardex'].search([('enter_date', '=',
                                                self.download_date)])
            content = "1|"+compa.police+"|"+compa.property_name.upper()[0:40]
            content += "|"
            content += datetime.datetime.now().strftime("%Y%m%d|%H%M")
            content += "|"+str(len(lines)) + """
"""

            for line in lines:
                if ((line.partner_id.documenttype is not False)
                        and (line.partner_id.poldocument is not False)
                        and (line.partner_id.firstname is not False)
                        and (line.partner_id.lastname is not False)):

                    if len(line.partner_id.code_ine.code) == 5:
                        content += "2|"+line.partner_id.poldocument.upper(
                            ) + "||"
                    else:
                        content += "2||"+line.partner_id.poldocument.upper(
                            ) + "|"
                    content += line.partner_id.documenttype + "|"
                    content += datetime.datetime.strptime(
                        line.partner_id.polexpedition,
                        "%Y-%m-%d").date().strftime("%Y%m%d") + "|"
                    apellidos = line.partner_id.lastname.split()
                    if len(apellidos) >= 2:
                        content += apellidos[0].upper() + "|"
                        apellidos.pop(0)
                        for apellido in apellidos:
                            content += apellido.upper() + " "
                        content = content[:len(content) - 1]
                    else:
                        content += apellidos[0].upper() + "|"
                    content += "|"
                    content += line.partner_id.firstname.upper() + "|"
                    content += line.partner_id.gender.upper()[0] + "|"
                    content += datetime.datetime.strptime(
                        line.partner_id.birthdate_date,
                        "%Y-%m-%d").date().strftime("%Y%m%d") + "|"
                    if len(line.partner_id.code_ine.code) == 5:
                        content += u'ESPAÑA|'
                    else:
                        content += line.partner_id.code_ine.name.upper()[0:21]
                        content += "|"
                    content += datetime.datetime.strptime(
                        line.enter_date,
                        "%Y-%m-%d").date().strftime("%Y%m%d") + "|"
                    content += """
"""
                else:
                    _logger.info('---- Problema generando el fichero. \
                                 Checkin Saltado ----')
                    return self.write({
                        'txt_message': _('Problem generating the file. \
                                         Checkin without data, \
                                         or incorrect data: - ' +
                                         line.partner_id.name)})

            return self.write({
                'txt_filename': compa.police + '.' + self.download_num,
                'txt_message': _(
                    'Generated file. Download it and give it to the police.'),
                'txt_binary': base64.encodestring(content.encode("iso-8859-1"))
                })
        return self.write({
            'txt_message': _('File not generated by configuration error.')
        })
