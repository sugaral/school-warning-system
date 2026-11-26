import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/major/' + url, ...arg)

export default {
	majorPage(data) {
		return request('page', data, 'get')
	},
	majorList(data) {
		return request('list', data, 'get')
	},
	submitForm(data, edit = false) {
		return request(edit ? 'edit' : 'add', data)
	},
	majorDelete(data) {
		return request('delete', data)
	},
	majorDetail(data) {
		return request('detail', data, 'get')
	},
	orgTreeSelector(data) {
		return request('orgTreeSelector', data, 'get')
	}
}
