import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/teacherbinding/' + url, ...arg)

export default {
	teacherBindingPage(data) {
		return request('page', data, 'get')
	},
	teacherBindingAdd(data) {
		return request('add', data)
	},
	teacherBindingDelete(data) {
		return request('delete', data)
	}
}
