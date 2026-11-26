import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/calendar/' + url, ...arg)

export default {
	calendarPage(data) {
		return request('page', data, 'get')
	},
	calendarAdd(data) {
		return request('add', data)
	},
	calendarDelete(data) {
		return request('delete', data)
	},
	orgTreeSelector(data) {
		return request('orgTreeSelector', data, 'get')
	}
}
